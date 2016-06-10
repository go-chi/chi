package converter

import (
	"fmt"
	"log"
	"reflect"

	"golang.org/x/net/context"
)

type Converter struct {
	// *from.Type => func(*from.Type) (*to.Type, error)
	ConversionStore map[reflect.Type]reflect.Value
}

func New() *Converter {
	return &Converter{
		ConversionStore: map[reflect.Type]reflect.Value{},
	}
}

func (c *Converter) Register(conversionFunc interface{}, conversionFuncs ...interface{}) {
	if err := c.register(conversionFunc); err != nil {
		panic(err)
	}
	for _, fn := range conversionFuncs {
		if err := c.register(fn); err != nil {
			panic(err)
		}
	}
}

func (c *Converter) Copy(converter *Converter, converters ...*Converter) {
	for typ, fn := range converter.ConversionStore {
		c.ConversionStore[typ] = fn
	}
	for _, converter := range converters {
		for typ, fn := range converter.ConversionStore {
			c.ConversionStore[typ] = fn
		}
	}
}

func (c *Converter) Convert(ctx context.Context, from interface{}) interface{} {
	obj := from
	for i := 0; i < 100; i++ {
		fn, ok := c.ConversionStore[reflect.TypeOf(obj)]
		if !ok {
			return obj
		}
		resp := fn.Call([]reflect.Value{reflect.ValueOf(ctx), reflect.ValueOf(obj)})
		if !resp[1].IsNil() {
			return resp[1].Interface()
		}
		obj = resp[0].Interface()
	}
	panic(fmt.Sprintf("render: Convert(%T): too many converts", from))
}

func (c *Converter) register(conversionFunc interface{}) error {
	fv := reflect.ValueOf(conversionFunc)
	ft := fv.Type()
	if ft.Kind() != reflect.Func {
		return fmt.Errorf("expected func, got: %v", ft)
	}
	if ft.NumIn() != 1 && ft.NumIn() != 2 {
		return fmt.Errorf("expected one or two 'in' params, got: %v", ft.NumIn())
	}
	if ft.NumOut() != 2 {
		return fmt.Errorf("expected two 'out' params, got: %v", ft.NumOut())
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

	// log.Printf("Register conversion(%v) => %v", ft.In(0).Elem(), ft.Out(0).Elem())
	// ConversionFuncs[typePair{ft.In(0).Elem(), ft.Out(0).Elem()}] = fv

	log.Printf("Register conversion(%v) => %v", ft.In(0), ft.Out(0))
	if ft.NumIn() == 1 {
		c.ConversionStore[ft.In(0)] = fv
	} else {
		c.ConversionStore[ft.In(1)] = fv
	}

	return nil
}
