package render

import (
	"encoding/json"
	"io"
	"io/ioutil"
)

var Bind = defaultBind

// defaultBind is a short-hand method for decoding a JSON request body.
func defaultBind(r io.Reader, v interface{}) error {
	defer io.Copy(ioutil.Discard, r)
	return json.NewDecoder(r).Decode(v)
}
