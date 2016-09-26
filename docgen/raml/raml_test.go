package raml_test

import (
	"net/http"
	"testing"

	"github.com/pressly/chi"
	"github.com/pressly/chi/_examples/versions/web"
	"github.com/pressly/chi/docgen/raml"
	yaml "gopkg.in/yaml.v2"
)

func TestWalkerRAML(t *testing.T) {
	r := web.Router()

	ramlDocs := &raml.RAML{
		Title:     "Big Mux",
		BaseUri:   "https://bigmux.example.com",
		Version:   "v1.0",
		MediaType: "application/json",
	}

	if err := chi.Walk(r, func(method string, route string, handler http.Handler, middlewares ...func(http.Handler) http.Handler) error {
		handlerInfo := chi.GetFuncInfo(handler)

		err := ramlDocs.Add(method, route, raml.Record{Description: handlerInfo.Comment})
		if err != nil {
			return err
		}

		return nil
	}); err != nil {
		t.Error(err)
	}

	_, err := yaml.Marshal(ramlDocs)
	if err != nil {
		t.Error(err)
	}
}
