package engine

import (
	"errors"
	"fmt"

	"nori/studio/server/internal/platform/queue"
)

// Registry maps operation names to operations.
type Registry struct {
	ops map[string]Operation
}

func NewRegistry(ops ...Operation) (*Registry, error) {
	r := &Registry{ops: make(map[string]Operation, len(ops))}
	for _, op := range ops {
		name := op.Name()
		if name == "" {
			return nil, errors.New("operation name is empty")
		}
		if _, ok := r.ops[name]; ok {
			return nil, fmt.Errorf("operation %q registered twice", name)
		}
		if op.InputVersion() < 1 {
			return nil, fmt.Errorf("operation %q has input version below 1", name)
		}
		if !queue.Valid(op.Queue()) {
			return nil, fmt.Errorf("operation %q uses unknown queue %q", name, op.Queue())
		}
		r.ops[name] = op
	}
	return r, nil
}

func (r *Registry) Get(name string) (Operation, bool) {
	op, ok := r.ops[name]
	return op, ok
}
