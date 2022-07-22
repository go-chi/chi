package main

import (
	"net/http"

	"github.com/FallenTaters/chio"
	"github.com/FallenTaters/chio/middleware"
)

func main() {
	r := chio.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)

	r.Get("/", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("hello world"))
	})

	http.ListenAndServe(":3333", r)
}
