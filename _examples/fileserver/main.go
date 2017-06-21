package main

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/go-chi/chi"
)

func main() {
	r := chi.NewRouter()

	r.Get("/", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("hi"))
	})

	workDir, _ := os.Getwd()
	filesDir := filepath.Join(workDir, "files")
	FileServer(r, "/files", http.Dir(filesDir))

	http.ListenAndServe(":3333", r)
}

// FileServer conveniently sets up a http.FileServer handler to serve
// static files from a http.FileSystem.
func FileServer(r chi.Router, path string, root http.FileSystem) {
	if strings.ContainsAny(path, ":*") {
		panic("FileServer does not permit URL parameters.")
	}

	fs := http.StripPrefix(path, http.FileServer(root))

	if path != "/" && path[len(path)-1] != '/' {
		r.Get(path, http.RedirectHandler(path+"/", 301).ServeHTTP)
		path += "/"
	}
	path += "*"

	r.Get(path, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fs.ServeHTTP(w, r)
	}))
}
