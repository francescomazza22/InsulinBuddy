// The starting food library for a brand-new install that has never signed in (2.86.0).
// It used to hold the food and recipe export from the original Base44 app (123 foods, including test items such as
// "Dummy meal"), which a fresh device loaded before its first sign-in. Francesco's real library lives in his account and
// arrives with sign-in, so the starter is now empty: a new device can never bring back foods he has deleted or edited.
// The old export is in git history (2.85.0 and earlier) if it is ever wanted. Keep this file: index.html and the
// service worker load it.
var SEED_FOODS = [];
