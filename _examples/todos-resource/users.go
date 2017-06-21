package main

import (
	"net/http"

	"github.com/go-chi/chi"
)

type usersResource struct{}

// Routes creates a REST router for the todos resource
func (rs usersResource) Routes() chi.Router {
	r := chi.NewRouter()
	// r.Use() // some middleware..

	r.Get("/", rs.List)    // GET /todos - read a list of todos
	r.Post("/", rs.Create) // POST /todos - create a new todo and persist it
	r.Put("/", rs.Delete)

	r.Route("/{id}", func(r chi.Router) {
		// r.Use(rs.TodoCtx) // lets have a todos map, and lets actually load/manipulate
		r.Get("/", rs.Get)       // GET /todos/{id} - read a single todo by :id
		r.Put("/", rs.Update)    // PUT /todos/{id} - update a single todo by :id
		r.Delete("/", rs.Delete) // DELETE /todos/{id} - delete a single todo by :id
	})

	return r
}

func (rs usersResource) List(w http.ResponseWriter, r *http.Request) {
	w.Write([]byte("aaa list of stuff.."))
}

func (rs usersResource) Create(w http.ResponseWriter, r *http.Request) {
	w.Write([]byte("aaa create"))
}

func (rs usersResource) Get(w http.ResponseWriter, r *http.Request) {
	w.Write([]byte("aaa get"))
}

func (rs usersResource) Update(w http.ResponseWriter, r *http.Request) {
	w.Write([]byte("aaa update"))
}

func (rs usersResource) Delete(w http.ResponseWriter, r *http.Request) {
	w.Write([]byte("aaa delete"))
}
