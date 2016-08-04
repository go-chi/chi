package chi

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestMiddlewareStack(t *testing.T) {
	handlerPrintCounter := func(w http.ResponseWriter, r *http.Request) {
		counter, _ := r.Context().Value("counter").(int)
		w.Write([]byte(fmt.Sprintf("%v", counter)))
	}

	mwIncreaseCounter := func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ctx := r.Context()
			counter, _ := ctx.Value("counter").(int)
			counter++
			ctx = context.WithValue(ctx, "counter", counter)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}

	// Each route represents value of its counter (number of applied middlewares).
	r := NewRouter() // counter == 0
	r.Get("/0", handlerPrintCounter)
	r.Group(func(r Router) {
		r.Use(mwIncreaseCounter) // counter == 1
		r.Get("/1", handlerPrintCounter)
		r.Get("/2", Use(mwIncreaseCounter).HandlerFunc(handlerPrintCounter))
		r.Group(func(r Router) {
			r.Use(mwIncreaseCounter, mwIncreaseCounter) // counter == 3
			r.Get("/3", handlerPrintCounter)
		})
		r.Route("/", func(r Router) {
			r.Use(mwIncreaseCounter, mwIncreaseCounter) // counter == 3
			r.Get("/4", Use(mwIncreaseCounter).HandlerFunc(handlerPrintCounter))
			r.Group(func(r Router) {
				r.Use(mwIncreaseCounter, mwIncreaseCounter) // counter == 5
				r.Get("/5", handlerPrintCounter)
				r.Get("/6", Use(mwIncreaseCounter).HandlerFunc(handlerPrintCounter))
			})
		})
	})

	ts := httptest.NewServer(r)
	defer ts.Close()

	for _, route := range []string{"0", "1", "2", "3", "4", "5", "6"} {
		t.Run(route, func(t *testing.T) {
			if _, body := testRequest(t, ts, "GET", "/"+route, nil); body != route {
				t.Errorf("expected %v, got %v", route, body)
			}
		})
	}
}
