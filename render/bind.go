package render

import (
	"encoding/json"
	"io"
	"io/ioutil"
)

func Bind(r io.Reader, v interface{}) error {
	defer io.Copy(ioutil.Discard, r)
	return json.NewDecoder(r).Decode(v)
}
