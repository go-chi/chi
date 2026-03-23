package chi

import (
	"net/http"
	"testing"
)

func TestPanicOnUnclosedBrace(t *testing.T) {
	defer func() {
		if recover() == nil {
			t.Error("expected panic()")
		}
	}()

	r := NewRouter()
	r.Get("/{open", func(w http.ResponseWriter, r *http.Request) {})
}

func TestPanicOnDuplicateParamKey(t *testing.T) {
	defer func() {
		if recover() == nil {
			t.Error("expected panic()")
		}
	}()

	r := NewRouter()
	r.Get("/{id}/things/{id}", func(w http.ResponseWriter, r *http.Request) {})
}

func TestPanicOnInvalidRegexp(t *testing.T) {
	defer func() {
		if recover() == nil {
			t.Error("expected panic()")
		}
	}()

	r := NewRouter()
	r.Get("/{id:(abc}", func(w http.ResponseWriter, r *http.Request) {})
}

func TestPanicOnNilRouteHandler(t *testing.T) {
	defer func() {
		if recover() == nil {
			t.Error("expected panic()")
		}
	}()

	r := NewRouter()
	r.Route("/path", nil)
}

func TestPanicOnNilMountHandler(t *testing.T) {
	defer func() {
		if recover() == nil {
			t.Error("expected panic()")
		}
	}()

	r := NewRouter()
	r.Mount("/path", nil)
}
