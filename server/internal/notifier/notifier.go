// Package notifier provides a pluggable external notification dispatcher.
// Each adapter implements the Sender interface and pushes events to a
// third-party service (Slack, Feishu/Lark, etc.). The Dispatcher fans out
// every event to all registered senders asynchronously so it never blocks the
// caller.
package notifier

import (
	"log"
	"sync"
)

// Event represents an outbound notification destined for external channels.
type Event struct {
	Kind    string // review_submitted | review_decided | comment_added | skill_published
	Title   string // one-line summary
	Body    string // longer Markdown body (may be empty)
	Actor   string // who triggered the event
	Target  string // ns/name or review ID
	URL     string // optional deep-link back into SkillHub
}

// Sender is the interface every adapter must satisfy. Send should be
// idempotent and best-effort — transient failures are logged but don't
// propagate to the caller.
type Sender interface {
	Name() string
	Send(evt Event) error
}

// Dispatcher manages a set of Senders and fans out events concurrently.
type Dispatcher struct {
	senders []Sender
}

// New creates a Dispatcher with zero or more initial senders.
func New(senders ...Sender) *Dispatcher {
	return &Dispatcher{senders: senders}
}

// Register adds a sender at runtime (e.g. after config reload).
func (d *Dispatcher) Register(s Sender) {
	d.senders = append(d.senders, s)
}

// Dispatch fans out evt to every registered sender. Calls are concurrent and
// best-effort — errors are logged but never returned.
func (d *Dispatcher) Dispatch(evt Event) {
	if len(d.senders) == 0 {
		return
	}
	var wg sync.WaitGroup
	for _, s := range d.senders {
		wg.Add(1)
		go func(sender Sender) {
			defer wg.Done()
			if err := sender.Send(evt); err != nil {
				log.Printf("[notifier] %s: %v", sender.Name(), err)
			}
		}(s)
	}
	wg.Wait()
}

// DispatchAsync is like Dispatch but does not block. Fire-and-forget.
func (d *Dispatcher) DispatchAsync(evt Event) {
	if len(d.senders) == 0 {
		return
	}
	go d.Dispatch(evt)
}
