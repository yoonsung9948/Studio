.PHONY: db migrate run test integration check

db:
	docker compose up -d --wait

migrate:
	go run ./cmd/studio migrate

run:
	go run ./cmd/studio

test:
	go test -race ./...

integration:
	go test -race -tags=integration ./...

check:
	go vet ./...
