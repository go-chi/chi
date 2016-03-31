package chi

import "golang.org/x/net/context"

var _ context.Context = &Context{}

type ctxKey int

const (
	rootCtxKey ctxKey = iota
)

type Context struct {
	context.Context

	// URL parameter key and values
	pkeys, pvalues []string

	// Routing path override used by subrouters
	routePath string
}

func newContext() *Context {
	rctx := &Context{}
	ctx := context.WithValue(context.Background(), rootCtxKey, rctx)
	rctx.Context = ctx
	return rctx
}

func (x *Context) Param(key string) string {
	for i, k := range x.pkeys {
		if k == key {
			return x.pvalues[i]
		}
	}
	return ""
}

func (x *Context) addParam(key string, value string) {
	x.pkeys = append(x.pkeys, key)
	x.pvalues = append(x.pvalues, value)
}

func (x *Context) delParam(key string) string {
	for i, k := range x.pkeys {
		if k == key {
			v := x.pvalues[i]
			x.pkeys = append(x.pkeys[:i], x.pkeys[i+1:]...)
			x.pvalues = append(x.pvalues[:i], x.pvalues[i+1:]...)
			return v
		}
	}
	return ""
}

func (x *Context) reset() {
	x.pkeys = x.pkeys[:0]
	x.pvalues = x.pvalues[:0]
	x.routePath = ""
}
