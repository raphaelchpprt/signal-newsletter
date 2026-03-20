# Signal Newsletter

Newsletter tech hebdomadaire automatisée, générée par Claude avec recherche web et envoyée par email chaque vendredi matin.

## Setup (5 minutes)

### 1. Créer le repo GitHub

```bash
git init
git add .
git commit -m "init: signal newsletter"
gh repo create signal-newsletter --private --push
```

### 2. Configurer les secrets GitHub

Dans ton repo → **Settings → Secrets and variables → Actions** → New repository secret :

| Secret | Valeur |
|--------|--------|
| `ANTHROPIC_API_KEY` | Ta clé API Anthropic (console.anthropic.com) |
| `SENDER_EMAIL` | L'adresse Gmail qui envoie (ex: raphael.signal@gmail.com) |
| `SENDER_PASSWORD` | **App Password** Gmail (pas ton mot de passe normal) |

### 3. Créer un App Password Gmail

Gmail exige un mot de passe d'application (pas le mot de passe principal) :

1. Va sur [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords)
2. Sélectionne "Mail" + "Other" → nomme-le "Signal Newsletter"
3. Copie le mot de passe généré → c'est la valeur de `SENDER_PASSWORD`

> Note : nécessite la validation en 2 étapes activée sur le compte Gmail.

### 4. Tester

Dans GitHub → **Actions → Signal Newsletter → Run workflow** pour déclencher manuellement.

## Fonctionnement

- **Déclenchement** : chaque vendredi à 7h00 (heure de Paris)
- **Modèle** : Claude Opus avec web_search pour chercher les actus de la semaine
- **Destinataire** : hi@raphaelch.me
- **Durée** : ~2-3 minutes de génération

## Coût estimé

~$0.05–0.15 par édition (API Anthropic, selon la longueur des recherches).
52 éditions/an ≈ $3–8/an.
