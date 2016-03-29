package render

import (
	"encoding/json"
	"io"
	"io/ioutil"
)

func Bind(r io.Reader, v interface{}) error {
	err := json.NewDecoder(r).Decode(v)
	io.Copy(ioutil.Discard, r)
	if err != nil {
		return err
	}
	return nil
}
