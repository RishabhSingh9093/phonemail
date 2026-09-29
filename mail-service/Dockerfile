FROM golang:1.21-alpine AS builder
WORKDIR /app
COPY main.go .
RUN go mod init mailservice && go build -o mailservice main.go

FROM alpine:latest
WORKDIR /app
COPY --from=builder /app/mailservice .
EXPOSE 8080
CMD ["./mailservice"]