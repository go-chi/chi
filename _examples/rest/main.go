package main

import (
	"net/http"

	"github.com/pressly/chi"
	"github.com/pressly/chi/middleware"
)

func main() {
	r := chi.New()

	r.Use(middleware.RequestID)
	r.Use(middleware.Logger)

	r.Get("/", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("..."))
	}))
	r.Get("/ping", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("."))
	})

	http.ListenAndServe(":3333", r)

}
