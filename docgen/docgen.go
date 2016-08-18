package docgen

import "github.com/pressly/chi"
import "encoding/json"

type Doc struct {
	Router DocRouter `json:"router"`
}

type DocRouter struct {
	Middlewares []DocMiddleware `json:"middlewares"`
	Routes      DocRoutes       `json:"routes"`
}

type DocMiddleware struct {
	FuncInfo
}

type DocRoute struct {
	Pattern  string      `json:"-"`
	Handlers DocHandlers `json:"handlers,omitempty"`
	Router   *DocRouter  `json:"router,omitempty"`
}

type DocRoutes map[string]DocRoute // Pattern : DocRoute

type DocHandler struct {
	Middlewares []DocMiddleware `json:"middlewares"`
	Method      string          `json:"method"`
	FuncInfo
}

type DocHandlers map[string]DocHandler // Method : DocHandler

type FuncInfo struct {
	Pkg       string `json:"pkg"`
	Func      string `json:"func"`
	Comment   string `json:"comment"`
	Anonymous bool   `json:"anonymous"`
	File      string `json:"file,omitempty"`
	Line      int    `json:"line,omitempty"`

	// TODO: another field called, Unresolvable bool ?
}

func JSONRoutesDoc(r chi.Routes) string {
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
