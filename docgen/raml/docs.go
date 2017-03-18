package raml

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/pressly/chi"
	yaml "gopkg.in/yaml.v2"
)

func Docs(r chi.Routes) (string, error) {
	ramlDocs := &RAML{
		Title:     "Chi versions",
		BaseUri:   "https://versions.example.com",
		Version:   "v2.0",
		MediaType: "application/json",
		Protocols: []string{"HTTPS"},
		Documentation: []Documentation{
			{Title: "", Content: "Example developer documentation."},
		},
	}

	err := chi.Walk(r, func(method string, route string, handler http.Handler, middlewares ...func(http.Handler) http.Handler) error {
		if method == "*" {
			return nil
		}

		info := chi.GetFuncInfo(handler)
		pkg := strings.Replace(info.Pkg, "github.com/pressly/chi/", "", -1)
		pkgDir := strings.LastIndex(pkg, "/")

		desc := fmt.Sprintf("## %v\n", info.Func)
		if info.Comment != "" {
			desc += fmt.Sprintf("%v\n\n", info.Comment)
		}

		desc += fmt.Sprintf("---\n\n#### [%v.**%v**](%v)\n", pkg[pkgDir+1:], info.Func, pkg[:pkgDir+1])
		if len(middlewares) > 0 {
			desc += fmt.Sprintf("\n\n")
			for _, mw := range middlewares {
				info := chi.GetFuncInfo(mw)
				pkg := strings.Replace(info.Pkg, "github.com/pressly/chi/", "", -1)
				pkgDir := strings.LastIndex(pkg, "/")
				desc += fmt.Sprintf("- [%v.**%v**](%v)\n", pkg[pkgDir+1:], info.Func, pkg[:pkgDir+1])
			}
		}

		record := Record{
			Description: desc,
			Responses:   Responses{},
		}

		switch method {
		case "POST":
			record.Responses[201] = Response{}
		case "GET", "PUT":
			record.Responses[200] = Response{}
		case "DELETE":
			record.Responses[204] = Response{}
		}

		ramlDocs.Add(method, route, record)

		return nil
	})
	if err != nil {
		return "", err
	}

	b, err := yaml.Marshal(ramlDocs)
	if err != nil {
		return "", err
	}

	return fmt.Sprintf("%s%s", Header, b), nil
}
