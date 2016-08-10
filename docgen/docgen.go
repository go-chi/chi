package docgen

import "github.com/pressly/chi"
import "encoding/json"

type Doc struct {
	ProjectPath string    `json:"projectPath"`
	Router      DocRouter `json:"router"`
}

type DocRouter struct {
	Middlewares []DocMiddleware `json:"middlewares"`
	Routes      DocRoutes       `json:"routes"`
}

type DocMiddleware struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	SourcePath  string `json:"sourcePath"`
}

type DocRoute struct {
	Pattern  string      `json:"-"`
	Handlers DocHandlers `json:"handlers,omitempty"`
	Router   *DocRouter  `json:"router,omitempty"`
}

type DocRoutes map[string]DocRoute // Pattern : DocRoute

type DocHandler struct {
	Method      string        `json:"method"`
	Description string        `json:"description,omitempty"`
	Middlewares DocMiddleware `json:"middlewares,omitempty"`
	Endpoint    string        `json:"endpoint"`
	SourcePath  string        `json:"sourcePath"`
}

type DocHandlers map[string]DocHandler // Method : DocHandler

func JSONRoutesDoc(r chi.Router) string {
	doc, _ := BuildDoc(r)
	v, err := json.MarshalIndent(doc, "", "  ")
	if err != nil {
		panic(err)
	}
	return string(v)
}

func MarkdownRoutesDoc(r chi.Router) string {
	// TODO ...
	return ""
}
