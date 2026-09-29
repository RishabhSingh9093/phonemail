package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/smtp"
	"os"
)

type EmailRequest struct {
	To      string `json:"to"`
	Subject string `json:"subject"`
	Body    string `json:"body"`
}

func sendEmailHandler(w http.ResponseWriter, r *http.Request) {
	var req EmailRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	smtpHost := os.Getenv("SMTP_HOST")
	smtpPort := os.Getenv("SMTP_PORT")
	addr := fmt.Sprintf("%s:%s", smtpHost, smtpPort)

	msg := []byte("To: " + req.To + "\r\n" +
		"Subject: " + req.Subject + "\r\n" +
		"\r\n" +
		req.Body + "\r\n")

	err := smtp.SendMail(addr, nil, "noreply@phonemail.com", []string{req.To}, msg)
	if err != nil {
		log.Printf("SMTP Error: %v", err)
		http.Error(w, "Failed to send email", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"status": "sent"})
}

func healthHandler(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusOK)
	w.Write([]byte("OK"))
}

func main() {
	http.HandleFunc("/send", sendEmailHandler)
	http.HandleFunc("/health", healthHandler)
	log.Println("Mail service running on :8080")
	log.Fatal(http.ListenAndServe(":8080", nil))
}