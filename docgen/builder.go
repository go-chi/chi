package docgen

import (
	"errors"
	"fmt"
	"net/http"
	"os"

	"github.com/pressly/chi"
)

func BuildDoc(r chi.Routes) (Doc, error) {
	d := Doc{}

	goPath := os.Getenv("GOPATH")
	if goPath == "" {
		return d, errors.New("docgen: unable to determine your $GOPATH")
	}

	// Walk and generate the router docs
	d.Router = buildDocRouter(r)
	return d, nil
}

func buildDocRouter(r chi.Routes) DocRouter {
	// rts := r.(chi.Routes)
	rts := r

	dr := DocRouter{Middlewares: []DocMiddleware{}}
	drts := DocRoutes{}
	dr.Routes = drts

	for _, mw := range rts.Middlewares() {
		dmw := DocMiddleware{
			FuncInfo: getFuncInfo(mw),
		}
		dr.Middlewares = append(dr.Middlewares, dmw)
	}

	for _, rt := range rts.Routes() {
		drt := DocRoute{Pattern: rt.Pattern, Handlers: DocHandlers{}}

		if rt.SubRouter != nil {
			subRoutes := rt.SubRouter.(chi.Routes)
			subDrts := buildDocRouter(subRoutes)
			drt.Router = &subDrts

		} else {
			hall := rt.Handlers["*"]
			for method, h := range rt.Handlers {
				if method != "*" && hall != nil && fmt.Sprintf("%v", hall) == fmt.Sprintf("%v", h) {
					continue
				}

				dh := DocHandler{Method: method, Middlewares: []DocMiddleware{}}

				var endpoint http.Handler
				chain, _ := h.(*chi.ChainHandler)

				if chain != nil {
					for _, mw := range chain.Middlewares {
						dh.Middlewares = append(dh.Middlewares, DocMiddleware{
							FuncInfo: getFuncInfo(mw),
						})
					}
					endpoint = chain.Endpoint
				} else {
					endpoint = h
				}
				dh.FuncInfo = getFuncInfo(endpoint)

				drt.Handlers[method] = dh
			}
		}

		drts[rt.Pattern] = drt
	}

	return dr
}

func PrintRoutes(prefix string, parentPattern string, r chi.Routes) { //chi.Router) {
	// rts := r.(chi.Routes).Routes()
	rts := r.Routes()
	for _, rt := range rts {
		if rt.SubRouter == nil {
			fmt.Println(prefix, parentPattern+rt.Pattern)
		} else {
			pat := rt.Pattern

			subRoutes := rt.SubRouter.(chi.Routes)
			PrintRoutes("=="+prefix, parentPattern+pat, subRoutes)
		}
	}
}
