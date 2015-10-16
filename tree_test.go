package chi

import (
	"fmt"
	"log"
	"net/http"
	"reflect"
	"testing"

	"golang.org/x/net/context"
	"golang.org/x/net/context/ctxhttp"
)

var (
	emptyParams map[string]string
)

func TestTree(t *testing.T) {
	hIndex := ctxhttp.HandlerFunc(func(ctx context.Context, w http.ResponseWriter, r *http.Request) {})
	hFavicon := ctxhttp.HandlerFunc(func(ctx context.Context, w http.ResponseWriter, r *http.Request) {})
	hArticleList := ctxhttp.HandlerFunc(func(ctx context.Context, w http.ResponseWriter, r *http.Request) {})
	hArticleNear := ctxhttp.HandlerFunc(func(ctx context.Context, w http.ResponseWriter, r *http.Request) {})
	hArticleShow := ctxhttp.HandlerFunc(func(ctx context.Context, w http.ResponseWriter, r *http.Request) {})
	hArticleShowRelated := ctxhttp.HandlerFunc(func(ctx context.Context, w http.ResponseWriter, r *http.Request) {})
	hArticleShowOpts := ctxhttp.HandlerFunc(func(ctx context.Context, w http.ResponseWriter, r *http.Request) {})
	hUserList := ctxhttp.HandlerFunc(func(ctx context.Context, w http.ResponseWriter, r *http.Request) {})
	hUserShow := ctxhttp.HandlerFunc(func(ctx context.Context, w http.ResponseWriter, r *http.Request) {})
	hAdminCatchall := ctxhttp.HandlerFunc(func(ctx context.Context, w http.ResponseWriter, r *http.Request) {})
	hStub := ctxhttp.HandlerFunc(func(ctx context.Context, w http.ResponseWriter, r *http.Request) {})
	_ = hStub

	tr := &tree{root: &node{}}

	// TODO: add regexp

	tr.Insert(mGET, "/", hIndex)
	tr.Insert(mGET, "/favicon.ico", hFavicon)
	tr.Insert(mGET, "/article", hArticleList)
	// tr.Insert(mGET, "/article/", hArticleList) // redirect..?
	tr.Insert(mGET, "/article/near", hArticleNear)
	tr.Insert(mGET, "/article/:id", hArticleShow)
	tr.Insert(mGET, "/article/:id", hArticleShow) // should overwrite, TODO: test single one of these..
	tr.Insert(mGET, "/article/:id/:opts", hArticleShowOpts)
	tr.Insert(mGET, "/article/:id//related", hArticleShowRelated)
	// tr.Insert(mGET, "/article/:aa", hStub) // TODO: what does goji do..?

	tr.Insert(mGET, "/admin/user", hUserList)
	tr.Insert(mGET, "/admin/user/", hUserList)
	tr.Insert(mGET, "/admin/user//:id", hUserShow)
	// tr.Insert(mGET, "/admin/user/:id", hUserShow) // TODO: how does goji handle those segments?
	tr.Insert(mGET, "/admin/*", hAdminCatchall)

	// TODO: test bad inserts ie.
	// tr.Insert(mGET, "")
	// tr.Insert(mGET, "/admin/:/joe/:/*") //...?
	// tr.Insert(mGET, "------------")

	tests := []struct {
		m methodTyp         // input method
		r string            // input request path
		h ctxhttp.Handler   // output matched handler
		p map[string]string // output params
	}{
		{m: mGET, r: "/", h: hIndex, p: emptyParams},
		{m: mGET, r: "/favicon.ico", h: hFavicon, p: emptyParams},
		{m: mGET, r: "/article", h: hArticleList, p: emptyParams},
		// {m: mGET, r: "/article/", h: hArticleList, p: emptyParams},
		{m: mGET, r: "/article/near", h: hArticleNear, p: emptyParams},
		{m: mGET, r: "/article/neard", h: hArticleShow, p: map[string]string{"id": "neard"}},
		{m: mGET, r: "/article/123", h: hArticleShow, p: map[string]string{"id": "123"}},
		{m: mGET, r: "/article/123/456", h: hArticleShowOpts, p: map[string]string{"id": "123", "opts": "456"}},
		{m: mGET, r: "/article/22//related", h: hArticleShowRelated, p: map[string]string{"id": "22"}},
		{m: mGET, r: "/admin/user", h: hUserList, p: emptyParams},
		{m: mGET, r: "/admin/user/", h: hUserList, p: emptyParams},
		// {m: mGET, r: "/admin/user/1", h: hUserShow, p: map[string]string{"id": "1"}}, // hmmm....
		{m: mGET, r: "/admin/user//1", h: hUserShow, p: map[string]string{"id": "1"}},
		// {m: mGET, r: "/admin/*", h: hAdminCatchall, p: emptyParams}, // TODO
	}

	// TEST CASE - TODO: .. hmm, so, while inserting a string,
	// we need to check the prefix .. like /:x or /* or /:id(Y)
	// if we do .. /ping/:id/hi and /ping/:sup/hi .. then :sup will overwrite..
	// what if we have /ping/:id/hi and /ping/:sup/bye - the :id and :sup are considered like a single char?

	log.Println("~~~~~~~~~")
	log.Println("~~~~~~~~~")
	debugPrintTree(0, 0, tr.root, 0)
	log.Println("~~~~~~~~~")
	log.Println("~~~~~~~~~")

	for i, tt := range tests {
		handler, params, _ := tr.Find(tt.m, tt.r)
		if fmt.Sprintf("%v", tt.h) != fmt.Sprintf("%v", handler) {
			t.Errorf("input [%d]: '%s %s' expecting handler:%v , got:%v", i, tt.m.String(), tt.r, tt.h, handler)
		}
		if !reflect.DeepEqual(tt.p, params) {
			t.Errorf("input [%d]: '%s %s' expecting params:%v , got:%v", i, tt.m.String(), tt.r, tt.p, params)
		}
	}
}

func debugPrintTree(parent int, i int, n *node, label byte) bool {
	if n.handler != nil {
		log.Printf("[node %d parent:%d] typ:%d prefix:%s label:%s numEdges:%d isLeaf:%v handler:%v\n", i, parent, n.typ, n.prefix, string(label), len(n.edges), n.isLeaf(), n.handler)
		// return true
	} else {
		log.Printf("[node %d parent:%d] typ:%d prefix:%s label:%s numEdges:%d isLeaf:%v\n", i, parent, n.typ, n.prefix, string(label), len(n.edges), n.isLeaf())
	}

	parent = i
	for _, e := range n.edges {
		i++
		if debugPrintTree(parent, i, e.node, e.label) {
			return true
		}
	}
	return false
}

func BenchmarkXTreeGet(b *testing.B) {
	h1 := ctxhttp.HandlerFunc(func(ctx context.Context, w http.ResponseWriter, r *http.Request) {})
	h2 := ctxhttp.HandlerFunc(func(ctx context.Context, w http.ResponseWriter, r *http.Request) {})

	tr := &tree{root: &node{}}
	tr.Insert(mGET, "/", h1)
	tr.Insert(mGET, "/ping", h2)
	tr.Insert(mGET, "/pingall", h2)
	tr.Insert(mGET, "/ping/:id", h2)
	tr.Insert(mGET, "/ping/:id/woop", h2)
	tr.Insert(mGET, "/ping/:id/:opt", h2)
	tr.Insert(mGET, "/pinggggg", h2)
	tr.Insert(mGET, "/hello", h1)

	b.ReportAllocs()
	b.ResetTimer()

	for i := 0; i < b.N; i++ {
		// tr.Find(mGET, "/ping/123/456")
		tr.Find(mGET, "/ping/123/456")
	}
}
