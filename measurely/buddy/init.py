"""LLM-powered friendly blurbs for Measurely."""
from .client import ask_buddy, ask_buddy_full
from .fallback import plain_summary

__all__ = ["ask_buddy", "ask_buddy_full", "plain_summary"]
