package notifier

import (
	"errors"
	"sync/atomic"
	"testing"
)

type mockSender struct {
	name  string
	calls int64
	fail  bool
}

func (m *mockSender) Name() string { return m.name }
func (m *mockSender) Send(_ Event) error {
	atomic.AddInt64(&m.calls, 1)
	if m.fail {
		return errors.New("boom")
	}
	return nil
}

func TestDispatchFansOut(t *testing.T) {
	a := &mockSender{name: "a"}
	b := &mockSender{name: "b"}
	d := New(a, b)

	evt := Event{Kind: "test", Title: "hello", Actor: "alice", Target: "ns/skill"}
	d.Dispatch(evt)

	if atomic.LoadInt64(&a.calls) != 1 {
		t.Fatalf("expected sender a to be called once, got %d", a.calls)
	}
	if atomic.LoadInt64(&b.calls) != 1 {
		t.Fatalf("expected sender b to be called once, got %d", b.calls)
	}
}

func TestDispatchDoesNotPanicOnFailure(t *testing.T) {
	bad := &mockSender{name: "bad", fail: true}
	d := New(bad)
	// Should not panic; error is logged internally.
	d.Dispatch(Event{Kind: "fail", Title: "x"})
	if atomic.LoadInt64(&bad.calls) != 1 {
		t.Fatal("expected call")
	}
}

func TestNewSlackNilOnEmpty(t *testing.T) {
	if s := NewSlack(""); s != nil {
		t.Fatal("expected nil for empty URL")
	}
}

func TestNewFeishuNilOnEmpty(t *testing.T) {
	if f := NewFeishu(""); f != nil {
		t.Fatal("expected nil for empty URL")
	}
}
