package docgen

import (
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/go-chi/chi"
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
	rts := r
	dr := DocRouter{Middlewares: []DocMiddleware{}}
	drts := DocRoutes{}
	dr.Routes = drts

	for _, mw := range rts.Middlewares() {
		dmw := DocMiddleware{
			FuncInfo: buildFuncInfo(mw),
		}
		dr.Middlewares = append(dr.Middlewares, dmw)
	}

	for _, rt := range rts.Routes() {
		drt := DocRoute{Pattern: rt.Pattern, Handlers: DocHandlers{}}

		if rt.SubRoutes != nil {
			subRoutes := rt.SubRoutes
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
							FuncInfo: buildFuncInfo(mw),
						})
					}
					endpoint = chain.Endpoint
				} else {
					endpoint = h
				}

				dh.FuncInfo = buildFuncInfo(endpoint)

				drt.Handlers[method] = dh
			}
		}

		drts[rt.Pattern] = drt
	}

	return dr
}

func buildFuncInfo(i interface{}) FuncInfo {
	fi := FuncInfo{}
	frame := getCallerFrame(i)
	goPathSrc := filepath.Join(os.Getenv("GOPATH"), "src")

	if frame == nil {
		fi.Unresolvable = true
		return fi
	}

	pkgName := getPkgName(frame.File)
	if pkgName == "chi" {
		fi.Unresolvable = true
	}
	funcPath := frame.Func.Name()

	idx := strings.Index(funcPath, "/"+pkgName)
	if idx > 0 {
		fi.Pkg = funcPath[:idx+1+len(pkgName)]
		fi.Func = funcPath[idx+2+len(pkgName):]
	} else {
		fi.Func = funcPath
	}

	if strings.Index(fi.Func, ".func") > 0 {
		fi.Anonymous = true
	}

	fi.File = frame.File
	fi.Line = frame.Line
	if filepath.HasPrefix(fi.File, goPathSrc) {
		fi.File = fi.File[len(goPathSrc)+1:]
	}

	// Check if file info is unresolvable
	if !strings.Contains(funcPath, pkgName) {
		fi.Unresolvable = true
	}

	if !fi.Unresolvable {
		fi.Comment = getFuncComment(frame.File, frame.Line)
	}

	return fi
}
