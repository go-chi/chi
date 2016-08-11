package main

import (
	"net/http"
	"os"
	"path/filepath"

	"github.com/pressly/chi"
)

func main() {
	r := chi.NewRouter()

	r.Get("/", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("hi"))
	})

	workDir, _ := os.Getwd()
	filesDir := filepath.Join(workDir, "files")
	r.FileServer("/files", http.Dir(filesDir))

	http.ListenAndServe(":3333", r)
}
