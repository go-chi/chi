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

func NewPresenter() *presenter {
	return &presenter{
		ConversionFnStore: map[reflect.Type]reflect.Value{},
	}
}

type presenter struct {
	ConversionFnStore map[reflect.Type]reflect.Value // map[*from.Type]func(context.Context, *from.Type) (*to.Type, error)
}

func (p *presenter) Register(conversionFunc interface{}, conversionFuncs ...interface{}) {
	if err := p.register(conversionFunc); err != nil {
		panic(err)
	}
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
	fv := reflect.ValueOf(conversionFunc)
	ft := fv.Type()
	if ft.Kind() != reflect.Func {
		return fmt.Errorf("expected func, got: %v", ft)
	}
	if ft.NumIn() != 2 {
		return fmt.Errorf("expected two arguments, got: %v", ft.NumIn())
	}
	if ft.NumOut() != 2 {
		return fmt.Errorf("expected two return values, got: %v", ft.NumOut())
	}
	// if ft.In(0).Kind() != reflect.Ptr {
	// 	return fmt.Errorf("expected pointer arg for 'in' param 0, got: %v", ft)
	// }
	// if ft.Out(0).Kind() != reflect.Ptr {
	// 	return fmt.Errorf("expected pointer arg for 'out' param 0, got: %v", ft)
	// }
	// var forErrorType error
	// errorType := reflect.TypeOf(&forErrorType).Elem()
	// if ft.Out(0) != errorType {
	// 	return fmt.Errorf("expected error return, got: %v", ft)
	// }

	p.ConversionFnStore[ft.In(1)] = fv

	return nil
}
