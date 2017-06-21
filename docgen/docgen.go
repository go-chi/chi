package docgen

import (
	"encoding/json"
	"fmt"

	"github.com/go-chi/chi"
)

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
	Pkg          string `json:"pkg"`
	Func         string `json:"func"`
	Comment      string `json:"comment"`
	File         string `json:"file,omitempty"`
	Line         int    `json:"line,omitempty"`
	Anonymous    bool   `json:"anonymous,omitempty"`
	Unresolvable bool   `json:"unresolvable,omitempty"`
}

func PrintRoutes(r chi.Routes) {
	var printRoutes func(parentPattern string, r chi.Routes)
	printRoutes = func(parentPattern string, r chi.Routes) {
		rts := r.Routes()
		for _, rt := range rts {
			if rt.SubRoutes == nil {
				fmt.Println(parentPattern + rt.Pattern)
			} else {
				pat := rt.Pattern

				subRoutes := rt.SubRoutes
				printRoutes(parentPattern+pat, subRoutes)
			}
		}
	}
	printRoutes("", r)
}

func JSONRoutesDoc(r chi.Routes) string {
	doc, _ := BuildDoc(r)
	v, err := json.MarshalIndent(doc, "", "  ")
	if err != nil {
		panic(err)
	}
	return string(v)
}
