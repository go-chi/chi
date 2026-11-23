package chi

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// TestMountingCycle ensures Mount() also panics for indirect mount cycles:
// routers with distinct trees that reach back to the mounting router through
// a chain of mounts (a mounts b, b mounts a). The check added for direct
// self-mounts in #1159 only compared the two trees involved in the Mount()
// call itself, so a cycle formed through an intermediary router slipped
// through, and any request falling through to the cycle re-entered routing
// with an unchanged route path forever, pinning a goroutine per request.
// See https://github.com/go-chi/chi/issues/843.

func expectMountPanic(t *testing.T, fn func()) {
	t.Helper()
	defer func() {
		if recover() == nil {
			t.Error("expected panic()")
		}
	}()
	fn()
}

func TestMountingCycleTwoRouters(t *testing.T) {
	a := NewRouter()
	b := NewRouter()
	b.Get("/hello", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("hello"))
	})

	a.Mount("/", b) // legal: distinct trees, no cycle yet

	expectMountPanic(t, func() {
		b.Mount("/", a) // closes the cycle a -> b -> a
	})

	// The rejected mount must not be half-registered: a still serves b.
	rec := httptest.NewRecorder()
	a.ServeHTTP(rec, httptest.NewRequest("GET", "/hello", nil))
	if rec.Body.String() != "hello" {
		t.Errorf("expected a to still serve b after rejected mount, got %q", rec.Body.String())
	}
}

func TestMountingCycleThreeRouters(t *testing.T) {
	a := NewRouter()
	b := NewRouter()
	c := NewRouter()

	a.Mount("/b", b)
	b.Mount("/c", c)

	expectMountPanic(t, func() {
		c.Mount("/a", a) // closes the cycle a -> b -> c -> a
	})
}

func TestMountingCycleThroughInlineMux(t *testing.T) {
	a := NewRouter()
	b := NewRouter()

	a.Mount("/api", b)

	// An inline mux derived from a shares a's tree, so mounting it on b
	// wires b back into a's tree, which already mounts b.
	inline := a.With(func(next http.Handler) http.Handler { return next })
	expectMountPanic(t, func() {
		b.Mount("/x", inline)
	})
}

func TestMountingCycleThroughRoute(t *testing.T) {
	parent := NewRouter()

	// The subrouter mounts the parent inside Route's fn; at that point the
	// parent does not mount the subrouter yet, so the cycle is only closed
	// by Route's own Mount call, which must be the one that panics.
	expectMountPanic(t, func() {
		parent.Route("/sub", func(r Router) {
			r.Mount("/", parent)
		})
	})
}

func TestMountingNoCycle(t *testing.T) {
	leaf := NewRouter()
	leaf.Get("/leaf", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("leaf"))
	})
	mid := NewRouter()
	mid.Mount("/mid", leaf)

	root := NewRouter()
	// A plain chain root -> mid -> leaf is not a cycle.
	root.Mount("/root", mid)
	// Mounting the same router in a second place (a DAG, not a cycle)
	// is legal and must keep working.
	root.Mount("/again", leaf)
	// The same router may also be mounted under a different parent.
	other := NewRouter()
	other.Mount("/other", leaf)

	for _, tc := range []struct {
		router Router
		path   string
	}{
		{root, "/root/mid/leaf"},
		{root, "/again/leaf"},
		{other, "/other/leaf"},
	} {
		rec := httptest.NewRecorder()
		tc.router.ServeHTTP(rec, httptest.NewRequest("GET", tc.path, nil))
		if rec.Body.String() != "leaf" {
			t.Errorf("GET %s: expected %q, got %q", tc.path, "leaf", rec.Body.String())
		}
	}
}

func TestMountingNonMuxHandlersUnaffected(t *testing.T) {
	r := NewRouter()
	r.Mount("/fn", http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		w.Write([]byte("fn"))
	}))

	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest("GET", "/fn/anything", nil))
	if rec.Body.String() != "fn" {
		t.Errorf("expected mounted HandlerFunc to serve, got %q", rec.Body.String())
	}
}
