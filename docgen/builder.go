package docgen

import (
	"fmt"
	"net/http"

	"github.com/pressly/chi"
)

func BuildDoc(r chi.Routes) (Doc, error) {
	d := Doc{}
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
		srcFile, srcLine := getFuncFileLine(mw)
		dmw := DocMiddleware{
			Name:        getFuncName(mw),
			Description: "TODO",
			SourcePath:  fmt.Sprintf("%s %d", srcFile, srcLine),
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
						srcFile, srcLine := getFuncFileLine(mw)
						dh.Middlewares = append(dh.Middlewares, DocMiddleware{
							Name:        getFuncName(mw),
							Description: "Inline MW, TODO",
							SourcePath:  fmt.Sprintf("%s %d", srcFile, srcLine),
						})
					}
					endpoint = chain.Endpoint
				} else {
					endpoint = h
				}

				// TODO: should we detect if the endpoint handler is in stdlib, and skip it or something..?

				dh.Endpoint = getFuncName(endpoint)

				srcFile, srcLine := getFuncFileLine(endpoint)
				dh.SourcePath = fmt.Sprintf("%s %d", srcFile, srcLine)

				// dh := DocHandler{
				// 	Method:     method,
				// 	Endpoint:   getFuncName(h),
				// 	SourcePath: fmt.Sprintf("%s %d", srcFile, srcLine),
				// }

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
