package render

import (
	"context"
	"fmt"
	"net/http"
	"reflect"
)

var (
	DefaultPresenter = NewPresenter()
	presenterCtxKey  = &contextKey{"Presenter"}
)

type Presenter interface {
	Present(r *http.Request, from interface{}) interface{}
}

// UsePresenter is a middleware that sets custom presenter into the context chain.
func UsePresenter(p Presenter) func(next http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		fn := func(w http.ResponseWriter, r *http.Request) {
			r = r.WithContext(context.WithValue(r.Context(), presenterCtxKey, p))
			next.ServeHTTP(w, r)
		}
		return http.HandlerFunc(fn)
	}
}

func NewPresenter(conversionFuncs ...interface{}) *presenter {
	p := &presenter{
		ConversionFnStore: map[reflect.Type]reflect.Value{},
	}
	p.Register(conversionFuncs...)
	return p
}

type presenter struct {
	ConversionFnStore map[reflect.Type]reflect.Value // map[*from.Type]func(context.Context, *from.Type) (*to.Type, error)
}

func (p *presenter) Register(conversionFuncs ...interface{}) {
	for _, fn := range conversionFuncs {
		if err := p.register(fn); err != nil {
			panic(err)
		}
	}
}

func (p *presenter) RegisterFrom(presenter *presenter, presenters ...*presenter) {
	for typ, fn := range presenter.ConversionFnStore {
		p.ConversionFnStore[typ] = fn
	}
	for _, presenter := range presenters {
		for typ, fn := range presenter.ConversionFnStore {
			p.ConversionFnStore[typ] = fn
		}
	}
}

func (p *presenter) Present(r *http.Request, from interface{}) interface{} {
	obj := from
	for i := 0; i < 100; i++ {
		fn, ok := p.ConversionFnStore[reflect.TypeOf(obj)]
		if !ok {
			return obj
		}
		resp := fn.Call([]reflect.Value{reflect.ValueOf(r), reflect.ValueOf(obj)})
		if !resp[1].IsNil() {
			return resp[1].Interface()
		}
		obj = resp[0].Interface()
	}
	panic(fmt.Sprintf("render: Present(%T): too many converts", from))
}

func (p *presenter) register(conversionFunc interface{}) error {
	fnType := reflect.TypeOf(conversionFunc)
	if fnType.Kind() != reflect.Func {
		return fmt.Errorf("expected func, got: %v", fnType)
	}
	if fnType.NumIn() != 2 {
		return fmt.Errorf("expected two arguments, got: %v", fnType.NumIn())
	}
	if fnType.NumOut() != 2 {
		return fmt.Errorf("expected two return values, got: %v", fnType.NumOut())
	}
	var requestZeroValue *http.Request
	if fnType.In(0) != reflect.TypeOf(&requestZeroValue).Elem() {
		return fmt.Errorf("expected *http.Request as first argument, got: %v", fnType)
	}
	var errorZeroValue error
	if !fnType.Out(1).Implements(reflect.TypeOf(&errorZeroValue).Elem()) {
		return fmt.Errorf("expected error as second return value, got: %v", fnType)
	}

	if _, ok := p.ConversionFnStore[fnType.In(1)]; ok {
		return fmt.Errorf("duplicate conversion function for type %v", fnType.In(1))
	}

	p.ConversionFnStore[fnType.In(1)] = reflect.ValueOf(conversionFunc)
	return nil
}
