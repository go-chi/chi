package chi

// Radix tree implementation below is a based on the original work by
// Armon Dadgar in https://github.com/armon/go-radix/blob/master/radix.go
// (MIT licensed)

// TODO: case insensitive ..

// TODO: trailing slash stuff...? perhaps in the Mux{} ..?

import (
	"errors"
	"log"
	"sort"
	"strings"
)

type nodeTyp uint8

const (
	ntStatic   nodeTyp = iota // /home
	ntRegexp                  // /:id([0-9]+) or #id^[0-9]+$
	ntParam                   // /:user
	ntCatchAll                // /api/v1/*
)

// WalkFn is used when walking the tree. Takes a
// key and value, returning if iteration should
// be terminated.
// type WalkFn func(s string, v interface{}) bool
// TODO: do we want to have method here..?
type WalkFn func(path string, handler Handler) bool

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
	handler Handler

	// Edges should be stored in-order for iteration.
	// We avoid a fully materialized slice to save memory,
	// since in most cases we expect to be sparse
	edges edges

	// TODO: optimization, do we keep track of the number of wildEdges?
	// nWildEdges int
}

func (n *node) isLeaf() bool {
	return n.handler != nil
}

// TODO: .. this method needs to recursively add nodes until its
// done.. break apart on the wildcards ...
func (n *node) addEdge(e edge) {
	search := e.node.prefix

	// log.Printf("addEdge(), search:%s\n", search)

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
		// log.Printf("addEdge() p == 0, starts with wildcard\n")

		handler := e.node.handler
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

			// TODO: confirm.
			// ie. e.node.prefix = ":hi/there", something else should define /:hi handler
			e.node.handler = nil

			search = search[p:]
			e2 := edge{
				label: search[0], // this will always start with /
				node: &node{
					typ:     ntStatic,
					prefix:  search,
					handler: handler,
				},
			}
			e.node.addEdge(e2)
		}

	} else if p > 0 {
		// Path has some wildcard
		// log.Printf("addEdge() p > 0, path has some wildcard\n")

		// starts with a static segment
		handler := e.node.handler
		e.node.typ = ntStatic
		e.node.prefix = search[:p]
		e.node.handler = nil

		// add the wild edge node
		search = search[p:]

		e2 := edge{
			label: search[0],
			node: &node{
				typ:     ntyp,
				prefix:  search,
				handler: handler,
			},
		}
		e.node.addEdge(e2)

	} else {
		// Path is all static
		// log.Printf("addEdge() p < 0, static\n")
		e.node.typ = ntyp

	}

	n.edges = append(n.edges, e)
	n.edges.Sort()
}

// TODO: wildcard aware..?
func (n *node) replaceEdge(e edge) {
	num := len(n.edges)
	for i := 0; i < num; i++ {
		if n.edges[i].label == e.label {
			n.edges[i].node = e.node
			return
		}
	}
	panic("chi: replacing missing edge")
}

func (n *node) getEdge(label byte) *node {
	// We do a linear search as we're sorted by a compound key
	num := len(n.edges)
	for i := 0; i < num; i++ {
		if n.edges[i].label == label {
			return n.edges[i].node
		}
	}
	return nil
}

func (n *node) findEdge(minTyp nodeTyp, label byte) *node {
	num := len(n.edges)
	idx := sort.Search(num, func(i int) bool {
		if n.edges[i].node.typ < minTyp {
			return false
		}
		switch n.edges[i].node.typ {
		case ntStatic:
			return n.edges[i].label >= label
		default: // wild nodes
			// TODO: right now we match them all.. but regexp should
			// run through regexp matcher
			return true
		}
		return false
	})

	if idx >= num {
		return nil
	}

	// TODO: ... review..
	if n.edges[idx].node.typ == ntStatic && n.edges[idx].label == label {
		return n.edges[idx].node
	} else if n.edges[idx].node.typ > ntStatic { // more match logic here...?
		return n.edges[idx].node // good..? regexp..?
	}
	return nil
}

// TODO: we can find a few optimizations here..
// TODO: rename to findPath ..? or findChildNode..?
func (n *node) findNode(minTyp nodeTyp, path string, params map[string]string) *node {
	nn := n
	search := path

	// log.Printf("\n\n======> SEARCH PATH %s\n", path)

	for {
		if len(search) == 0 {
			if nn.isLeaf() {
				// log.Printf("** FOUND NODE for path:%s - prefix:%s typ:%d\n", path, nn.prefix, nn.typ)
				return nn
			}
			break
		}

		// log.Printf("==> SEARCH %s\n", search)

		wn := nn.findEdge(ntStatic+1, search[0]) // wild node
		nn = nn.findEdge(ntStatic, search[0])    // any node

		if nn == nil && wn == nil {
			// Found nothing at all
			// log.Println("~~ nothing, 0 0")
			break

		} else if nn == nil && wn != nil {
			// Found only a wild node
			// log.Println("~~ 0 static, 1 wild")
			nn = wn

		} else if nn == wn {
			// Same, do nothing.
			// log.Println("~~ nn == wn")

		} else if nn != nil && wn != nil {
			// Found both static and wild matching nodes
			// log.Println("~~ 1 static, 1 wild")

			// log.Printf("~~~~~> search:%s nn.prefix:%s wn.prefix:%s\n", search, nn.prefix, wn.prefix)

			// TODO: needs optimization...

			// ..attempts to get to the final node..

			// hmm, we wont need to do this if we know to not search nodes where static edges == 0
			stsearch := search[len(nn.prefix):]
			if stsearch != "" {
				sn := nn.findNode(ntStatic, stsearch, params)

				// As static leaf couldn't be found, use the wild node
				if sn == nil {
					// log.Println("sn == nil.. go wild")
					nn = wn
				}
			}
		}

		if nn.typ > ntStatic {
			// log.Printf("!!!!!!!!!!!!!!!!!!!! typ:%d", nn.typ)

			p := -1
			if nn.typ != ntCatchAll {
				p = strings.IndexByte(search, '/')
			}
			if p < 0 {
				p = len(search)
			}

			if nn.typ == ntCatchAll {
				params["*"] = search[:p]
			} else {
				params[nn.prefix[1:]] = search[:p]
			}

			search = search[p:]
			continue
		}

		// Consume the search prefix
		if strings.HasPrefix(search, nn.prefix) {
			search = search[len(nn.prefix):]
		} else {
			break
		}
	}
	return nil
}

type edges []edge

func (e edges) Len() int {
	return len(e)
}

// Sort the list of edges by tuple, <edge.node.typ, edge.label>
func (e edges) Less(i, j int) bool {
	if e[i].node.typ < e[j].node.typ {
		return true
	}
	if e[i].node.typ > e[j].node.typ {
		return false
	}
	return e[i].label < e[j].label
}

func (e edges) Swap(i, j int) {
	e[i], e[j] = e[j], e[i]
}

func (e edges) Sort() {
	sort.Sort(e)
}

// Tree implements a radix tree. This can be treated as a
// Dictionary abstract data type. The main advantage over
// a standard hash map is prefix-based lookups and
// ordered iteration.
type tree struct {
	root *node
}

// TODO: I suppose we can have different trees depending on the method...?
// For now, just assume method is always GET

var insertcnt int = -1

// TODO: do we return an error or panic..? what does goji do..
func (t *tree) Insert(method methodTyp, pattern string, handler Handler) error {

	insertcnt += 1
	// log.Println("")
	// log.Printf("=> INSERT #%d %s\n", insertcnt, pattern)

	var parent *node
	n := t.root
	search := pattern

	iter := -1

	for {
		iter += 1

		// Handle key exhaustion
		if len(search) == 0 {
			// Insert or update the node's leaf handler
			n.handler = handler
			return nil
		}

		// Look for the edge
		parent = n
		// log.Printf("insert (%d): search[0] %s\n", iter, string(search[0]))
		n = n.getEdge(search[0])

		// No edge, create one
		if n == nil {
			// log.Printf("insert (%d): new edge, prefix %s\n", iter, search)
			e := edge{
				label: search[0],
				node: &node{
					prefix:  search,
					handler: handler,
				},
			}
			parent.addEdge(e)

			return nil
		}

		// log.Printf("insert (%d): ~~ search:%s n.prefix:%s n.typ:%d\n", iter, search, n.prefix, n.typ)

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
		// log.Printf("insert (%d): commonPrefix %d '%s' + '%s'\n", iter, commonPrefix, search[:commonPrefix], search[commonPrefix:])
		if commonPrefix == len(n.prefix) {
			// the common prefix is as long as the current node's prefix we're attempting to insert.
			// keep the search going.
			search = search[commonPrefix:]
			// log.Printf("insert (%d): commonPrefix == len('%s'), continue\n", iter, n.prefix)
			continue
		}

		// TODO: .......... ************ fix splitting node logic separately..
		// right now, these are all new nodes..
		// log.Printf("=========> SPLIT NODE.......... child.prefix:%s parent.prefix:%s\n", search[:commonPrefix], parent.prefix)
		// log.Printf("=========> current node, n.prefix:%s n.typ:%d\n", n.prefix, n.typ)

		// Split the node
		child := &node{
			typ:    ntStatic, // TODO: HMM.. will this always be static...?
			prefix: search[:commonPrefix],
		}
		// log.Printf("insert (%d): split node, parentPrefix:%s, nodePrefix:%s, childPrefix:%s\n", iter, parent.prefix, n.prefix, child.prefix)
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

		// log.Printf("=========> RESTORE NODE... child appends edge with prefix:%s\n", n.prefix)

		// If the new key is a subset, add to to this node
		search = search[commonPrefix:]
		if len(search) == 0 {
			// log.Println("*** new key is a subset.. set handler, move on..")
			child.handler = handler
			return nil
		}

		// Create a new edge for the node
		// log.Printf("insert (%d): add new edge, label:%s nodePrefix:%s\n", iter, string(search[0]), search)
		child.addEdge(edge{
			label: search[0],
			node: &node{
				typ:     ntStatic,
				prefix:  search,
				handler: handler,
			},
		})
		return nil
	}
	return nil
}

// TODO: do we need to return error...?
func (t *tree) Find(method methodTyp, path string) (Handler, map[string]string, error) {
	// var params map[string]string
	params := make(map[string]string, 0) // TODO: allocation?

	// log.Println("tree Find", path)

	node := t.root.findNode(ntStatic, path, params)

	if node == nil || node.handler == nil { // TODO: || handler..?
		// log.Println("..not found.")
		return nil, nil, errors.New("not found..")
	}

	// log.Println("found", path)
	return node.handler, params, nil
}

// Walk is used to walk the tree
func (t *tree) Walk(fn WalkFn) {
	t.recursiveWalk(t.root, fn)
}

// recursiveWalk is used to do a pre-order walk of a node
// recursively. Returns true if the walk should be aborted
func (t *tree) recursiveWalk(n *node, fn WalkFn) bool {
	// Visit the leaf values if any
	if n.handler != nil && fn(n.prefix, n.handler) { // TODO ..... walkFn() ..?
		return true
	}

	// Recurse on the children
	for _, e := range n.edges {
		if t.recursiveWalk(e.node, fn) {
			return true
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

func WOOTrecursiveWalk(parent int, i int, n *node, label byte) bool {
	if n.handler != nil {
		log.Printf("[node %d parent:%d] typ:%d prefix:%s label:%s numEdges:%d isLeaf:%v handler:%v\n", i, parent, n.typ, n.prefix, string(label), len(n.edges), n.isLeaf(), n.handler)
		// return true
	} else {
		log.Printf("[node %d parent:%d] typ:%d prefix:%s label:%s numEdges:%d isLeaf:%v\n", i, parent, n.typ, n.prefix, string(label), len(n.edges), n.isLeaf())
	}

	parent = i
	for _, e := range n.edges {
		i++
		if WOOTrecursiveWalk(parent, i, e.node, e.label) {
			return true
		}
	}
	return false
}
