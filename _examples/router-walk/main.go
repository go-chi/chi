package main

import (
	"fmt"
	"net/http"

	"github.com/go-chi/chi"
)

func main() {
	r := chi.NewRouter()
	r.Get("/", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("root."))
	})

	r.Route("/road", func(r chi.Router) {
		r.Get("/left", func(w http.ResponseWriter, r *http.Request) {
			w.Write([]byte("left road"))
		})
		r.Post("/right", func(w http.ResponseWriter, r *http.Request) {
			w.Write([]byte("right road"))
		})
	})

	r.Put("/ping", Ping)

	walkFunc := func(method string, route string, handler http.Handler, middlewares ...func(http.Handler) http.Handler) error {
		fmt.Printf("%s %s\n", method, route)
		return nil
	}

	if err := chi.Walk(r, walkFunc); err != nil {
		fmt.Printf("Logging err: %s\n", err.Error())
	}
}

// Ping returns pong
func Ping(w http.ResponseWriter, r *http.Request) {
	w.Write([]byte("pong"))
}
