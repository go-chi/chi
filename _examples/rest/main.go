package main

import (
	"fmt"
	"math/rand"
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
		// Stop processing when client disconnects.
		r.Use(middleware.CloseNotify)

		// Stop processing after 2.5 seconds.
		r.Use(middleware.Timeout(2500 * time.Millisecond))

		r.Get("/slow", func(ctx context.Context, w http.ResponseWriter, r *http.Request) {
			rand.Seed(time.Now().Unix())

			// Processing will take 1-5 seconds.
			processTime := time.Duration(rand.Intn(4)+1) * time.Second

			select {
			case <-ctx.Done():
				switch ctx.Err() {
				case context.DeadlineExceeded:
					w.Write([]byte("Processing too slow\n"))
				default:
					w.Write([]byte("Context canceled\n"))
				}
				return

			case <-time.After(processTime):
				// The above channel simulates some hard work.
			}

			w.Write([]byte(fmt.Sprintf("Processed in %v seconds\n", processTime)))
		})
	})

	http.ListenAndServe(":3333", r)
}
