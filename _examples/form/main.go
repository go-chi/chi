package main

import (
	"encoding/json"
	"net/http"

	"github.com/ggicci/httpin"
	"github.com/go-chi/chi/v5"
)

type ListUserReposInput struct {
	Username   string `in:"path=username"`
	Visibility string `in:"query=visibility"`
	Fork       bool   `in:"query=fork"`
	Token      string `in:"header=Authorization"`
}

func ListUserRepos(rw http.ResponseWriter, r *http.Request) {
	// Retrieve you data in one line of code!
	input := r.Context().Value(httpin.Input).(*ListUserReposInput)

	json.NewEncoder(rw).Encode(input)
}

func init() {
	// Register a directive named "path" to retrieve values from `chi.URLParam`,
	// i.e. decode path variables.
	httpin.UseGochiURLParam("path", chi.URLParam)
}

func main() {
	r := chi.NewRouter()

	// Bind input struct with handler.
	r.With(
		httpin.NewInput(ListUserReposInput{}),
	).Get("/users/{username}/repos", ListUserRepos)

	http.ListenAndServe(":3333", r)
}
