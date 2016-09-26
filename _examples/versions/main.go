//
// Versions
// ========
// This example demonstrates the use of the render subpackage and its
// render.Presenter interface to transform a handler response to easily
// handle API versioning.
//
package main

import (
	"fmt"
	"net/http"
	"os"

	"github.com/pressly/chi/docgen/raml"

	"github.com/pressly/chi/_examples/versions/web"
)

func main() {
	if len(os.Args) > 1 && os.Args[1] == "docs" {
		docs, err := raml.Docs(router())
		if err != nil {
			fmt.Fprintf(os.Stderr, "%v", err)
			os.Exit(1)
		}
		fmt.Println(docs)
		return
	}

	http.ListenAndServe(":3333", web.Router())
}
