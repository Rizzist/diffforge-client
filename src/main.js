import { invoke } from "@tauri-apps/api/core";
import "./styles.css";

const API_BASE_URL = "https://diffforge.ai/api";

const apiStatus = document.querySelector(".apiStatus");
const apiStatusLabel = document.querySelector("#api-status-label");
const apiBase = document.querySelector("#api-base");
const apiCheckButton = document.querySelector("#api-check-button");
const loginForm = document.querySelector("#login-form");
const formMessage = document.querySelector("#form-message");
const emailInput = document.querySelector("#email");
const passwordInput = document.querySelector("#password");

apiBase.textContent = API_BASE_URL;

function setApiStatus(state, message) {
  apiStatus.dataset.state = state;
  apiStatusLabel.textContent = message;
}

async function checkBackend() {
  setApiStatus("checking", "Checking backend");
  apiCheckButton.disabled = true;

  try {
    const result = await invoke("backend_ping");
    setApiStatus("online", result.message || "Backend connected");
  } catch (error) {
    setApiStatus("offline", error || "Backend unavailable");
  } finally {
    apiCheckButton.disabled = false;
  }
}

function handleLoginSubmit(event) {
  event.preventDefault();

  const email = emailInput.value.trim();

  if (!email || passwordInput.value.length < 8) {
    formMessage.textContent = "Enter an email and an 8 character password.";
    formMessage.dataset.state = "error";
    return;
  }

  formMessage.textContent = "Desktop sign-in is ready for the next backend auth route.";
  formMessage.dataset.state = "info";
}

apiCheckButton.addEventListener("click", checkBackend);
loginForm.addEventListener("submit", handleLoginSubmit);

checkBackend();
