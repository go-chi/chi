package main

import (
	"net/http"

	"github.com/pressly/chi"
	"github.com/pressly/chi/middleware"
)

func main() {
	r := chi.NewRouter()

	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)

	r.Get("/", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("."))
	})

	r.Mount("/", usersResource{}.Routes())
	r.Mount("/", todosResource{}.Routes())

	// r.Mount("/",
	// 	usersResource{}.Routes(),
	// 	todosResource{}.Routes(),
	// )

	// r.Mount(chi.Route("/users", router))

	// r.Route("/", chi.RouterFunc(usersResource{}.Routes()))

	// r.Mount(usersResource{}.Routes())

	// r.Mount("/",
	// 	usersResource{}.Routes(),
	// 	todosResource{}.Routes(),
	// )

	// hmmm.. perhaps r.Mount() will actually add to the existing tree..?
	// instead of making a real subrouter and joining with a middleware......?
	// effectively, joining 2 trees...

	http.ListenAndServe(":3333", r)
}
