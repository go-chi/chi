package main

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/go-chi/chi"
)

type todosResource struct {
	ID   int64
	Task string
}

var todobase = make(map[int64]todosResource)

// Routes creates a REST router for the todos resource
func (rs todosResource) Routes() chi.Router {
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
		r.Get("/sync", rs.Sync)
	})

	return r
}

func (rs todosResource) List(w http.ResponseWriter, r *http.Request) {
	// Display marshalled json from
	todolist, _ := json.Marshal(todobase)
	w.WriteHeader(200)
	w.Write(todolist)
}

func (rs todosResource) Create(w http.ResponseWriter, r *http.Request) {
	decoder := json.NewDecoder(r.Body)
	var t todosResource
	err := decoder.Decode(&t)
	if err != nil {
		panic(err)
	}
	todobase[t.ID] = t
	id, _ := json.Marshal(t)
	w.WriteHeader(200)
	w.Write(id)
}

func (rs todosResource) Get(w http.ResponseWriter, r *http.Request) {

	id := chi.URLParam(r, "id")
	var idx int64
	idx, _ = strconv.ParseInt(id, 10, 64)

	var emp = todosResource{}

	onetodo := todobase[idx]
	if onetodo == emp {
		w.WriteHeader(http.StatusNotFound)
		w.Write([]byte("404 HTTP status code returned!"))

	} else {
		rer, _ := json.Marshal(onetodo)
		w.Write(rer)
	}

}

func (rs todosResource) Update(w http.ResponseWriter, r *http.Request) {
	// Exactly same as Update - maybe response should differ if it's overwrite
	// It's called Upsert
	decoder := json.NewDecoder(r.Body)
	var t todosResource
	err := decoder.Decode(&t)
	if err != nil {
		panic(err)
	}
	todobase[t.ID] = t
	id, _ := json.Marshal(t)
	w.WriteHeader(200)
	w.Write(id)
}

func (rs todosResource) Delete(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var idx int64
	idx, _ = strconv.ParseInt(id, 10, 64)
	delete(todobase, idx)
	w.WriteHeader(200)
	w.Write([]byte("Deleted"))
}

func (rs todosResource) Sync(w http.ResponseWriter, r *http.Request) {
	// What should Sync do?
	w.Write([]byte("todo sync"))
}
