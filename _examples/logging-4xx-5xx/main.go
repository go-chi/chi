package main

import (
	"encoding/json"
	"flag"
	"net/http"

	"github.com/go-chi/chi"
	"github.com/go-chi/chi/middleware"
)

// Response defines response object
type Response struct {
	Message string `json:"message"`
}

func main() {
	flag.Parse()

	r := chi.NewRouter()

	r.Use(middleware.RequestID)
	r.Use(middleware.Logger4xxAnd5xx)
	r.Use(middleware.Recoverer)

	r.Get("/", testOK)
	r.Get("/log-4xx", test4xx)
	r.Get("/log-5xx", test5xx)

	http.ListenAndServe(":3333", r)
}

func testOK(w http.ResponseWriter, r *http.Request) {
	resp := Response{Message: "success"}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(resp)
}

func test4xx(w http.ResponseWriter, r *http.Request) {
	resp := Response{Message: "bad request"}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusBadRequest)
	json.NewEncoder(w).Encode(resp)
}

func test5xx(w http.ResponseWriter, r *http.Request) {
	resp := Response{Message: "server error"}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusInternalServerError)
	json.NewEncoder(w).Encode(resp)
}
