package render

import (
	"context"
	"fmt"
	"net/http"
	"reflect"
)

var (
	presenterCtxKey = &contextKey{"Presenter"}
)

type Presenter interface {
	Present(r *http.Request, from interface{}) (*http.Request, interface{})
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
		fnStore: map[reflect.Type]reflect.Value{},
	}
	p.Register(conversionFuncs...)
	return p
}

type presenter struct {
	fnStore    map[reflect.Type]reflect.Value // map[*FromType]func(r *http.Request, from *FromType) (*ToType, error)
	fnCatchAll func(r *http.Request, from interface{}) (*http.Request, interface{})
}

func (p *presenter) Register(conversionFuncs ...interface{}) {
	for _, fn := range conversionFuncs {
		if err := p.register(fn); err != nil {
			panic(err)
		}
	}
}

func (p *presenter) CopyFrom(presenters ...*presenter) {
	for _, presenter := range presenters {
		if p.fnCatchAll != nil {
			p.fnCatchAll = presenter.fnCatchAll
		}
		for typ, fn := range presenter.fnStore {
			p.fnStore[typ] = fn
		}
	}
}

func (p *presenter) Present(r *http.Request, from interface{}) (*http.Request, interface{}) {
	obj := from
	if p.fnCatchAll != nil {
		r, obj = p.fnCatchAll(r, obj)
	}
	for {
		fn, ok := p.fnStore[reflect.TypeOf(obj)]
		if !ok {
			if reflect.TypeOf(obj).Kind() == reflect.Slice {
				return r, p.presentSlice(r, obj)
			}
			return r, obj
		}
		resp := fn.Call([]reflect.Value{reflect.ValueOf(r), reflect.ValueOf(obj)})
		if !resp[1].IsNil() {
			return r, resp[1].Interface()
		}
		obj = resp[0].Interface()
	}
	panic("unreachable")
}

func (p *presenter) presentSlice(r *http.Request, from interface{}) interface{} {
	elemFromType := reflect.TypeOf(from).Elem()
	fn, ok := p.fnStore[elemFromType]
	if !ok {
		return from
	}

	elemToType := fn.Type().Out(0)
	fromSlice := reflect.ValueOf(from)

	toSlice := reflect.MakeSlice(reflect.SliceOf(elemToType), fromSlice.Len(), fromSlice.Len())
	for i := 0; i < fromSlice.Len(); i++ {
		resp := fn.Call([]reflect.Value{reflect.ValueOf(r), fromSlice.Index(i)})
		if !resp[1].IsNil() {
			return resp[1].Interface()
		}
		toSlice.Index(i).Set(resp[0])
	}
	return toSlice.Interface()
}

func (p *presenter) register(conversionFunc interface{}) error {
	if catchAllFn, ok := conversionFunc.(func(r *http.Request, from interface{}) (*http.Request, interface{})); ok {
		if p.fnCatchAll != nil {
			return fmt.Errorf("duplicate catch-all conversion function of type %T", conversionFunc)
		}
		p.fnCatchAll = catchAllFn
		return nil
	}

	fnType := reflect.TypeOf(conversionFunc)
	if fnType.Kind() != reflect.Func {
		return fmt.Errorf("expected func(r *http.Request, from FromType) (ToType, error), got %v", fnType)
	}
	if fnType.NumIn() != 2 {
		return fmt.Errorf("expected func(r *http.Request, from FromType) (ToType, error), got %v", fnType)
	}
	if fnType.NumOut() != 2 {
		return fmt.Errorf("expected func(r *http.Request, from FromType) (ToType, error), got %v", fnType)
	}
	var requestZeroValue *http.Request
	if fnType.In(0) != reflect.TypeOf(&requestZeroValue).Elem() {
		return fmt.Errorf("expected func(r *http.Request, from FromType) (ToType, error), got %v", fnType)
	}
	var errorZeroValue error
	if !fnType.Out(1).Implements(reflect.TypeOf(&errorZeroValue).Elem()) {
		return fmt.Errorf("expected func(r *http.Request, from FromType) (ToType, error), got %v", fnType)
	}

	if _, ok := p.fnStore[fnType.In(1)]; ok {
		return fmt.Errorf("duplicate conversion function for type %v", fnType.In(1))
	}

	p.fnStore[fnType.In(1)] = reflect.ValueOf(conversionFunc)

	// Check for conversion loop. The following returns nil if there was no loop.
	typ := fnType.In(1)
	for i := 0; i < 100; i++ {
		fn, ok := p.fnStore[typ]
		if !ok {
			return nil
		}
		typ = fn.Type().Out(0)
	}

	// Conversion loop was detected. Clean up and error out:
	delete(p.fnStore, fnType.In(1))
	return fmt.Errorf("conversion loop for type %v", typ)
}
