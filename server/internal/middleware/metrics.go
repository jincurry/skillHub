package middleware

import (
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gin-gonic/gin"
)

// Histogram bucket boundaries in seconds, picked to match the Prometheus
// default for HTTP latency (0.005s through 10s) so dashboards using the
// stock metric names render correctly out of the box.
var defaultBuckets = []float64{
	0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
}

// counterKey is the label tuple identifying a single counter timeseries.
// We keep the cardinality bounded by always normalizing route to the gin
// FullPath (template, e.g. /reviews/:id) rather than the raw URL.
type counterKey struct {
	method string
	route  string
	status int
}

type histogramSeries struct {
	mu      sync.Mutex
	buckets []float64
	counts  []uint64
	sum     float64
	count   uint64
}

func newHistogramSeries() *histogramSeries {
	return &histogramSeries{
		buckets: defaultBuckets,
		counts:  make([]uint64, len(defaultBuckets)),
	}
}

func (h *histogramSeries) observe(v float64) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.sum += v
	h.count++
	for i, b := range h.buckets {
		if v <= b {
			h.counts[i]++
		}
	}
}

// Registry is the in-process metric store. Safe for concurrent use; one
// instance per gin engine is fine.
type Registry struct {
	mu         sync.RWMutex
	counters   map[counterKey]*uint64
	histograms map[string]*histogramSeries // keyed by method+route
	inflight   int64
}

// NewRegistry builds a fresh metrics registry.
func NewRegistry() *Registry {
	return &Registry{
		counters:   make(map[counterKey]*uint64),
		histograms: make(map[string]*histogramSeries),
	}
}

func (r *Registry) incCounter(k counterKey) {
	r.mu.RLock()
	v, ok := r.counters[k]
	r.mu.RUnlock()
	if ok {
		atomic.AddUint64(v, 1)
		return
	}
	r.mu.Lock()
	if v, ok := r.counters[k]; ok {
		atomic.AddUint64(v, 1)
		r.mu.Unlock()
		return
	}
	var n uint64 = 1
	r.counters[k] = &n
	r.mu.Unlock()
}

func (r *Registry) observe(method, route string, secs float64) {
	key := method + " " + route
	r.mu.RLock()
	h, ok := r.histograms[key]
	r.mu.RUnlock()
	if !ok {
		r.mu.Lock()
		if h, ok = r.histograms[key]; !ok {
			h = newHistogramSeries()
			r.histograms[key] = h
		}
		r.mu.Unlock()
	}
	h.observe(secs)
}

// Instrument returns a gin middleware that records counter + latency
// histogram + in-flight gauge for every request. Uses gin's FullPath so the
// route template (not the raw URL with IDs) is used as the label.
func (r *Registry) Instrument() gin.HandlerFunc {
	return func(c *gin.Context) {
		atomic.AddInt64(&r.inflight, 1)
		start := time.Now()
		c.Next()
		atomic.AddInt64(&r.inflight, -1)

		route := c.FullPath()
		if route == "" {
			// 404 / no matched route — bucket under a single label so we
			// don't unbound cardinality with arbitrary URLs.
			route = "<unmatched>"
		}
		r.incCounter(counterKey{
			method: c.Request.Method,
			route:  route,
			status: c.Writer.Status(),
		})
		r.observe(c.Request.Method, route, time.Since(start).Seconds())
	}
}

// Handler serves the registry as a Prometheus text-format exposition.
// It conforms to the simple format (https://prometheus.io/docs/instrumenting/exposition_formats/).
func (r *Registry) Handler() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
		c.Status(http.StatusOK)
		var b strings.Builder

		// In-flight gauge.
		b.WriteString("# HELP http_requests_in_flight Number of HTTP requests currently being processed.\n")
		b.WriteString("# TYPE http_requests_in_flight gauge\n")
		fmt.Fprintf(&b, "http_requests_in_flight %d\n", atomic.LoadInt64(&r.inflight))

		// Counter.
		b.WriteString("# HELP http_requests_total Total HTTP requests served, labelled by method, route, status.\n")
		b.WriteString("# TYPE http_requests_total counter\n")
		r.mu.RLock()
		keys := make([]counterKey, 0, len(r.counters))
		for k := range r.counters {
			keys = append(keys, k)
		}
		r.mu.RUnlock()
		sort.Slice(keys, func(i, j int) bool {
			if keys[i].route != keys[j].route {
				return keys[i].route < keys[j].route
			}
			if keys[i].method != keys[j].method {
				return keys[i].method < keys[j].method
			}
			return keys[i].status < keys[j].status
		})
		for _, k := range keys {
			r.mu.RLock()
			v := atomic.LoadUint64(r.counters[k])
			r.mu.RUnlock()
			fmt.Fprintf(&b, `http_requests_total{method=%q,route=%q,status="%d"} %d`+"\n",
				k.method, k.route, k.status, v)
		}

		// Histogram.
		b.WriteString("# HELP http_request_duration_seconds Latency of HTTP requests in seconds.\n")
		b.WriteString("# TYPE http_request_duration_seconds histogram\n")
		r.mu.RLock()
		hnames := make([]string, 0, len(r.histograms))
		for n := range r.histograms {
			hnames = append(hnames, n)
		}
		r.mu.RUnlock()
		sort.Strings(hnames)
		for _, name := range hnames {
			r.mu.RLock()
			h := r.histograms[name]
			r.mu.RUnlock()
			// "METHOD /route" -> labels
			sp := strings.IndexByte(name, ' ')
			method, route := name[:sp], name[sp+1:]
			h.mu.Lock()
			for i, b2 := range h.buckets {
				fmt.Fprintf(&b,
					`http_request_duration_seconds_bucket{method=%q,route=%q,le=%q} %d`+"\n",
					method, route, strconv.FormatFloat(b2, 'f', -1, 64), h.counts[i],
				)
			}
			fmt.Fprintf(&b,
				`http_request_duration_seconds_bucket{method=%q,route=%q,le="+Inf"} %d`+"\n",
				method, route, h.count)
			fmt.Fprintf(&b,
				`http_request_duration_seconds_sum{method=%q,route=%q} %s`+"\n",
				method, route, strconv.FormatFloat(h.sum, 'f', -1, 64))
			fmt.Fprintf(&b,
				`http_request_duration_seconds_count{method=%q,route=%q} %d`+"\n",
				method, route, h.count)
			h.mu.Unlock()
		}

		_, _ = c.Writer.WriteString(b.String())
	}
}

