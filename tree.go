package chi

// Radix tree implementation below is a based on the original work by
// Armon Dadgar in https://github.com/armon/go-radix/blob/master/radix.go
// (MIT licensed)

import (
	"net/http"
	"sort"
	"strings"
)

// TODO: set the RoutePattern on the RouteContext

type methodTyp int

const (
	mCONNECT methodTyp = 1 << iota
	mDELETE
	mGET
	mHEAD
	mOPTIONS
	mPATCH
	mPOST
	mPUT
	mTRACE

	mALL methodTyp = mCONNECT | mDELETE | mGET | mHEAD | mOPTIONS |
		mPATCH | mPOST | mPUT | mTRACE
)

var methodMap = map[string]methodTyp{
	"CONNECT": mCONNECT,
	"DELETE":  mDELETE,
	"GET":     mGET,
	"HEAD":    mHEAD,
	"OPTIONS": mOPTIONS,
	"PATCH":   mPATCH,
	"POST":    mPOST,
	"PUT":     mPUT,
	"TRACE":   mTRACE,
}

type nodeTyp uint8

const (
	ntStatic   nodeTyp = iota // /home
	ntRegexp                  // /:id([0-9]+) or #id^[0-9]+$
	ntParam                   // /:user
	ntCatchAll                // /api/v1/*
)

// TODO: comment
// TODO: if WalkFn is exported, this needs to be as well, which its better not to.
// I have a few ideas, will massage it later.
type methodHandlers map[methodTyp]http.Handler

// WalkFn is used when walking the tree. Takes a
// key and value, returning if iteration should
// be terminated.

// TODO: .. lets leave it like this for now..
// but we could also just make it
// type WalkFn func(method string, pattern string, handler http.Handler) bool
type WalkFn func(path string, handlers methodHandlers) bool

// edge is used to represent an edge node
type edge struct {
	label byte
	node  *node
}

type node struct {
	typ nodeTyp

	// prefix is the common prefix we ignore
	prefix string

	// HTTP handler on the leaf node
	// handler http.Handler
	handlers methodHandlers

	// Edges should be stored in-order for iteration,
	// in groups of the node type.
	edges [ntCatchAll + 1]edges
}

func (n *node) isLeaf() bool {
	return n.handlers != nil
}

func (n *node) addEdge(e edge) {
	search := e.node.prefix

	// Find any wildcard segments
	p := strings.IndexAny(search, ":*")

	// Determine new node type
	ntyp := ntStatic
	if p >= 0 {
		switch search[p] {
		case ':':
			ntyp = ntParam
		case '*':
			ntyp = ntCatchAll
		}
	}

	if p == 0 {
		// Path starts with a wildcard

		handlers := e.node.handlers
		e.node.typ = ntyp

		if ntyp == ntCatchAll {
			p = -1
		} else {
			p = strings.IndexByte(search, '/')
		}
		if p < 0 {
			p = len(search)
		}
		e.node.prefix = search[:p]

		if p != len(search) {
			// add edge for the remaining part, split the end.
			e.node.handlers = nil

			search = search[p:]
			e2 := edge{
				label: search[0], // this will always start with /
				node: &node{
					typ:      ntStatic,
					prefix:   search,
					handlers: handlers,
				},
			}
			e.node.addEdge(e2)
		}

	} else if p > 0 {
		// Path has some wildcard

		// starts with a static segment
		handlers := e.node.handlers
		e.node.typ = ntStatic
		e.node.prefix = search[:p]
		e.node.handlers = nil

		// add the wild edge node
		search = search[p:]

		e2 := edge{
			label: search[0],
			node: &node{
				typ:      ntyp,
				prefix:   search,
				handlers: handlers,
			},
		}
		e.node.addEdge(e2)

	} else {
		// Path is all static
		e.node.typ = ntyp

	}

	n.edges[e.node.typ] = append(n.edges[e.node.typ], e)
	n.edges[e.node.typ].Sort()
}

func (n *node) replaceEdge(e edge) {
	num := len(n.edges[e.node.typ])
	for i := 0; i < num; i++ {
		if n.edges[e.node.typ][i].label == e.label {
			n.edges[e.node.typ][i].node = e.node
			return
		}
	}
	panic("chi: replacing missing edge")
}

func (n *node) getEdge(label byte) *node {
	for _, edges := range n.edges {
		num := len(edges)
		for i := 0; i < num; i++ {
			if edges[i].label == label {
				return edges[i].node
			}
		}
	}
	return nil
}

func (n *node) findEdge(ntyp nodeTyp, label byte) *node {
	subedges := n.edges[ntyp]
	num := len(subedges)
	idx := 0

	switch ntyp {
	case ntStatic:
		i, j := 0, num-1
		for i <= j {
			idx = i + (j-i)/2
			if label > subedges[idx].label {
				i = idx + 1
			} else if label < subedges[idx].label {
				j = idx - 1
			} else {
				i = num // breaks cond
			}
		}
		if subedges[idx].label != label {
			return nil
		}
		return subedges[idx].node

	default: // wild nodes
		// TODO: right now we match them all.. but regexp should
		// run through regexp matcher
		return subedges[idx].node
	}
}

// Recursive edge traversal by checking all nodeTyp groups along the way.
// It's like searching through a three-dimensional radix trie.
func (n *node) findNode(ctx *Context, method methodTyp, path string) *node {
	nn := n
	search := path

	for t, edges := range nn.edges {
		ntyp := nodeTyp(t)
		if len(edges) == 0 {
			continue
		}

		// search subset of edges of the index for a matching node
		var label byte
		if search != "" {
			label = search[0]
		}
		xn := nn.findEdge(ntyp, label) // next node

		if xn == nil {
			continue
		}

		// Prepare next search path by trimming prefix from requested path
		xsearch := search
		if xn.typ > ntStatic {
			p := -1
			if xn.typ < ntCatchAll {
				p = strings.IndexByte(xsearch, '/')
			}
			if p < 0 {
				p = len(xsearch)
			}

			if xn.typ == ntCatchAll {
				ctx.Params.Add("*", xsearch)
			} else {
				ctx.Params.Add(xn.prefix[1:], xsearch[:p])
			}

			xsearch = xsearch[p:]
		} else if strings.HasPrefix(xsearch, xn.prefix) {
			xsearch = xsearch[len(xn.prefix):]
		} else {
			continue // no match
		}

		// did we find it yet?
		if len(xsearch) == 0 {
			if xn.isLeaf() {
				return xn
			}
		}

		// recursively find the next node..
		fin := xn.findNode(ctx, method, xsearch)
		if fin != nil {
			// found a node, return it
			return fin
		}

		// Did not found final handler, let's remove the param here if it was set
		// TODO: can we do even better now though...?
		if xn.typ > ntStatic && xn.typ < ntCatchAll {
			ctx.Params.Del(xn.prefix[1:])
		}
	}

	return nil
}

func (n *node) setHandler(method methodTyp, handler http.Handler) {
	if n.handlers == nil {
		n.handlers = make(methodHandlers, 0)
	}
	if method == mALL {
		for _, m := range methodMap {
			n.handlers[m] = handler
		}
	} else {
		n.handlers[method] = handler
	}
}

type edges []edge

// Sort the list of edges by label
func (e edges) Len() int           { return len(e) }
func (e edges) Less(i, j int) bool { return e[i].label < e[j].label }
func (e edges) Swap(i, j int)      { e[i], e[j] = e[j], e[i] }
func (e edges) Sort()              { sort.Sort(e) }

// Tree implements a radix tree. This can be treated as a
// Dictionary abstract data type. The main advantage over
// a standard hash map is prefix-based lookups and
// ordered iteration.
type tree struct {
	root *node
}

func (t *tree) Insert(method methodTyp, pattern string, handler http.Handler) {
	var parent *node
	n := t.root
	search := pattern

	for {
		// Handle key exhaustion
		if len(search) == 0 {
			// Insert or update the node's leaf handler
			// n.handler = handler
			n.setHandler(method, handler)
			return
		}

		// Look for the edge
		parent = n
		n = n.getEdge(search[0])

		// No edge, create one
		if n == nil {
			e := edge{
				label: search[0],
				node: &node{
					prefix: search,
					// handler: handler,
				},
			}
			e.node.setHandler(method, handler)
			parent.addEdge(e)
			return
		}

		if n.typ > ntStatic {
			// We found a wildcard node, meaning search path starts with
			// a wild prefix. Trim off the wildcard search path and continue.
			p := strings.Index(search, "/")
			if p < 0 {
				p = len(search)
			}
			search = search[p:]
			continue
		}

		// Static node fall below here.
		// Determine longest prefix of the search key on match.
		commonPrefix := t.longestPrefix(search, n.prefix)
		if commonPrefix == len(n.prefix) {
			// the common prefix is as long as the current node's prefix we're attempting to insert.
			// keep the search going.
			search = search[commonPrefix:]
			continue
		}

		// Split the node
		child := &node{
			typ:    ntStatic,
			prefix: search[:commonPrefix],
		}
		parent.replaceEdge(edge{
			label: search[0],
			node:  child,
		})

		// Restore the existing node
		child.addEdge(edge{
			label: n.prefix[commonPrefix],
			node:  n,
		})
		n.prefix = n.prefix[commonPrefix:]

		// If the new key is a subset, add to to this node
		search = search[commonPrefix:]
		if len(search) == 0 {
			// child.handler = handler
			child.setHandler(method, handler)
			return
		}

		// Create a new edge for the node
		e := edge{
			label: search[0],
			node: &node{
				typ:    ntStatic,
				prefix: search,
				// handler: handler,
			},
		}
		e.node.setHandler(method, handler)
		child.addEdge(e)
		return
	}
}

func (t *tree) Find(ctx *Context, method methodTyp, path string) methodHandlers {
	node := t.root.findNode(ctx, method, path)
	if node == nil {
		return nil
	}
	return node.handlers
}

// Walk is used to walk the tree
func (t *tree) Walk(fn WalkFn) {
	t.recursiveWalk(t.root.prefix, t.root, fn)
}

// recursiveWalk is used to do a pre-order walk of a node
// recursively. Returns true if the walk should be aborted
func (t *tree) recursiveWalk(pattern string, n *node, fn WalkFn) bool {
	pattern += n.prefix

	// Visit the leaf values if any
	if n.handlers != nil && fn(pattern, n.handlers) {
		return true
	}

	// Recurse on the children
	for _, edges := range n.edges {
		for _, e := range edges {
			if t.recursiveWalk(pattern, e.node, fn) {
				return true
			}
		}
	}
	return false
}

// longestPrefix finds the length of the shared prefix
// of two strings
func (t *tree) longestPrefix(k1, k2 string) int {
	max := len(k1)
	if l := len(k2); l < max {
		max = l
	}
	var i int
	for i = 0; i < max; i++ {
		if k1[i] != k2[i] {
			break
		}
	}
	return i
}
