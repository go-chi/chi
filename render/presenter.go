package render

import (
	"fmt"
	"net/http"
	"reflect"

	"github.com/pressly/chi"

	"golang.org/x/net/context"
)

var DefaultPresenter = NewPresenter()

type Presenter interface {
	Present(ctx context.Context, from interface{}) interface{}
}

// UsePresenter is a middleware that sets custom presenter into the context chain.
func UsePresenter(p Presenter) func(next chi.Handler) chi.Handler {
	return func(next chi.Handler) chi.Handler {
		fn := func(ctx context.Context, w http.ResponseWriter, r *http.Request) {
			ctx = context.WithValue(ctx, presenterCtxKey, p)
			next.ServeHTTPC(ctx, w, r)
		}
		return chi.HandlerFunc(fn)
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

func (p *presenter) Present(ctx context.Context, from interface{}) interface{} {
	obj := from
	for i := 0; i < 100; i++ {
		fn, ok := p.ConversionFnStore[reflect.TypeOf(obj)]
		if !ok {
			return obj
		}
		resp := fn.Call([]reflect.Value{reflect.ValueOf(ctx), reflect.ValueOf(obj)})
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
	var contextZeroValue context.Context
	if !fnType.In(0).Implements(reflect.TypeOf(&contextZeroValue).Elem()) {
		return fmt.Errorf("expected context.Context as first argument, got: %v", fnType)
	}
	var errorZeroValue error
	if !fnType.Out(1).Implements(reflect.TypeOf(&errorZeroValue).Elem()) {
		return fmt.Errorf("expected error as second return value, got: %v", fnType)
	}

	p.ConversionFnStore[fnType.In(1)] = reflect.ValueOf(conversionFunc)
	return nil
}
