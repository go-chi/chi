package main

import (
	"net/http"
	"time"

	"github.com/pressly/chi"
	"github.com/pressly/chi/middleware"
	"golang.org/x/net/context"
)

func main() {
	r := chi.New()

	r.Use(middleware.RequestID)
	r.Use(middleware.Logger)

	r.Get("/", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("..."))
	}))

	r.Get("/ping", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("pong"))
	})

	// Slow handlers.
	r.Group(func(r chi.Router) {
		r.Use(middleware.CloseNotify)

		r.Get("/slow", func(ctx context.Context, w http.ResponseWriter, r *http.Request) {
			select {
			case <-ctx.Done():
				return
			case <-time.After(5 * time.Second):
			}

			w.Write([]byte("Processed after 5 seconds"))
		})
	})

	http.ListenAndServe(":3333", r)
}
