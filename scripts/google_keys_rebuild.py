#!/usr/bin/env python3
"""Re-add the Google sign-in dialog + setup-helper i18n keys (Tasks 34/34c/38
rebuild after the sandbox snapshot regression wiped the dictionaries).

Inserts a block of `auth.*` keys right before the `resetToastTitle:` line in
each language file. Idempotent: skips files that already have googleSetupTitle.
"""
import re
from pathlib import Path

ROOT = Path("/home/z/my-project/src/lib/i18n")

# NOTE: TS strings here are single-quoted — avoid straight apostrophes in
# the copy (use typographic ’ where needed) so no escaping is required.
BLOCKS = {
    "en": """    googleErrorTitle: 'Google sign-in failed',
    googleErrorDesc: 'We could not start Google sign-in. Please try again.',
    googleDemoBadge: 'Local demo',
    googleDemoTitle: 'Sign in with Google (demo)',
    googleDemoDesc: 'This server has no Google OAuth credentials, so a demo chooser is shown here. Pick any email address to continue.',
    googleDemoEmailLabel: 'Google email',
    googleDemoContinue: 'Continue',
    googleSetupLink: 'Google sign-in not working? Fix it here',
    googleSetupTitle: 'Set up Google sign-in',
    googleSetupIntro: 'Google rejects the sign-in until this exact Redirect URI is registered in your Google Cloud Console.',
    googleSetupUriLabel: 'Authorized redirect URI',
    googleSetupCopy: 'Copy',
    googleSetupCopied: 'Copied!',
    googleSetupSteps: [
      'Open console.cloud.google.com and go to APIs & Services → Credentials.',
      'Click your OAuth 2.0 Client (Web client).',
      'Under “Authorized redirect URIs” click “Add URI”.',
      'Paste the URI below and save.',
      'Wait a few minutes — Google may need a moment to apply the change.',
    ],
    googleSetupNote: 'While the app is in Testing mode, your Google account must be added as a Test user.',
    googleSetupClose: 'Done',
""",
    "hi": """    googleErrorTitle: 'Google साइन-इन विफल',
    googleErrorDesc: 'हम Google साइन-इन शुरू नहीं कर सके। कृपया पुनः प्रयास करें।',
    googleDemoBadge: 'स्थानीय डेमो',
    googleDemoTitle: 'Google से साइन इन करें (डेमो)',
    googleDemoDesc: 'इस सर्वर पर Google OAuth क्रेडेंशियल नहीं हैं, इसलिए यहाँ एक डेमो चयनकर्ता दिखाया जाता है। जारी रखने के लिए कोई भी ईमेल चुनें।',
    googleDemoEmailLabel: 'Google ईमेल',
    googleDemoContinue: 'जारी रखें',
    googleSetupLink: 'Google साइन-इन काम नहीं कर रहा? इसे यहाँ ठीक करें',
    googleSetupTitle: 'Google साइन-इन सेट अप करें',
    googleSetupIntro: 'जब तक यह सटीक Redirect URI आपके Google Cloud Console में पंजीकृत नहीं होता, तब तक Google साइन-इन अस्वीकार कर देता है।',
    googleSetupUriLabel: 'अधिकृत रीडायरेक्ट URI',
    googleSetupCopy: 'कॉपी',
    googleSetupCopied: 'कॉपी हो गया!',
    googleSetupSteps: [
      'console.cloud.google.com खोलें और APIs & Services → Credentials में जाएँ।',
      'अपना OAuth 2.0 क्लाइंट (Web) खोलें।',
      '“Authorized redirect URIs” के अंतर्गत “Add URI” पर क्लिक करें।',
      'नीचे दिया URI पेस्ट करके सेव करें।',
      'कुछ मिनट प्रतीक्षा करें — Google को बदलाव लागू होने में समय लग सकता है।',
    ],
    googleSetupNote: 'जब ऐप Testing मोड में हो, तब आपका Google खाता Test user के रूप में जोड़ा होना चाहिए।',
    googleSetupClose: 'पूर्ण',
""",
    "mr": """    googleErrorTitle: 'Google साइन-इन अयशस्वी',
    googleErrorDesc: 'Google साइन-इन सुरू करता आले नाही. कृपया पुन्हा प्रयत्न करा.',
    googleDemoBadge: 'स्थानिक डेमो',
    googleDemoTitle: 'Google सह साइन इन करा (डेमो)',
    googleDemoDesc: 'या सर्व्हरवर Google OAuth क्रेडेन्शल नाहीत, म्हणून येथे डेमो निवडक दाखवला आहे. सुरू ठेवण्यासाठी कोणताही ईमेल निवडा.',
    googleDemoEmailLabel: 'Google ईमेल',
    googleDemoContinue: 'सुरू ठेवा',
    googleSetupLink: 'Google साइन-इन चालत नाहीये? येथे दुरुस्त करा',
    googleSetupTitle: 'Google साइन-इन सेट अप करा',
    googleSetupIntro: 'हे अचूक Redirect URI तुमच्या Google Cloud Console मध्ये नोंदवेपर्यंत Google साइन-इन नाकारते.',
    googleSetupUriLabel: 'अधिकृत रीडायरेक्ट URI',
    googleSetupCopy: 'कॉपी',
    googleSetupCopied: 'कॉपी झाले!',
    googleSetupSteps: [
      'console.cloud.google.com उघडा आणि APIs & Services → Credentials कडे जा.',
      'तुमचा OAuth 2.0 क्लायंट (Web) उघडा.',
      '“Authorized redirect URIs” अंतर्गत “Add URI” वर क्लिक करा.',
      'खालील URI पेस्ट करून जतन करा.',
      'काही मिनिटे प्रतीक्षा करा — Google ला बदल लागू होण्यासाठी वेळ लागू शकतो.',
    ],
    googleSetupNote: 'ॲप Testing मोडमध्ये असताना तुमचे Google खाते Test user म्हणून जोडलेले असणे आवश्यक आहे.',
    googleSetupClose: 'पूर्ण',
""",
    "es": """    googleErrorTitle: 'Error al iniciar sesión con Google',
    googleErrorDesc: 'No pudimos iniciar el acceso con Google. Inténtalo de nuevo.',
    googleDemoBadge: 'Demo local',
    googleDemoTitle: 'Iniciar sesión con Google (demo)',
    googleDemoDesc: 'Este servidor no tiene credenciales de Google OAuth, por lo que se muestra un selector de demostración. Elige cualquier correo para continuar.',
    googleDemoEmailLabel: 'Correo de Google',
    googleDemoContinue: 'Continuar',
    googleSetupLink: '¿No funciona el acceso con Google? Arréglalo aquí',
    googleSetupTitle: 'Configurar el acceso con Google',
    googleSetupIntro: 'Google rechaza el inicio de sesión hasta que este Redirect URI exacto esté registrado en tu Google Cloud Console.',
    googleSetupUriLabel: 'URI de redirección autorizado',
    googleSetupCopy: 'Copiar',
    googleSetupCopied: '¡Copiado!',
    googleSetupSteps: [
      'Abre console.cloud.google.com y ve a APIs & Services → Credentials.',
      'Abre tu cliente OAuth 2.0 (Web).',
      'En “Authorized redirect URIs” haz clic en “Add URI”.',
      'Pega el URI de abajo y guarda.',
      'Espera unos minutos: Google puede tardar un poco en aplicar el cambio.',
    ],
    googleSetupNote: 'Mientras la app esté en modo Testing, tu cuenta de Google debe estar añadida como usuario de prueba.',
    googleSetupClose: 'Listo',
""",
    "fr": """    googleErrorTitle: 'Échec de la connexion Google',
    googleErrorDesc: 'Nous n’avons pas pu démarrer la connexion Google. Veuillez réessayer.',
    googleDemoBadge: 'Démo locale',
    googleDemoTitle: 'Se connecter avec Google (démo)',
    googleDemoDesc: 'Ce serveur n’a pas d’identifiants Google OAuth, un sélecteur de démo est donc affiché. Choisissez n’importe quel e-mail pour continuer.',
    googleDemoEmailLabel: 'E-mail Google',
    googleDemoContinue: 'Continuer',
    googleSetupLink: 'La connexion Google ne fonctionne pas ? Corrigez-la ici',
    googleSetupTitle: 'Configurer la connexion Google',
    googleSetupIntro: 'Google refuse la connexion tant que cet URI de redirection exact n’est pas enregistré dans votre Google Cloud Console.',
    googleSetupUriLabel: 'URI de redirection autorisé',
    googleSetupCopy: 'Copier',
    googleSetupCopied: 'Copié !',
    googleSetupSteps: [
      'Ouvrez console.cloud.google.com puis APIs & Services → Credentials.',
      'Ouvrez votre client OAuth 2.0 (Web).',
      'Sous « Authorized redirect URIs », cliquez sur « Add URI ».',
      'Collez l’URI ci-dessous et enregistrez.',
      'Patientez quelques minutes — Google peut mettre du temps à appliquer la modification.',
    ],
    googleSetupNote: 'Tant que l’app est en mode Testing, votre compte Google doit être ajouté comme utilisateur test.',
    googleSetupClose: 'Terminé',
""",
    "de": """    googleErrorTitle: 'Google-Anmeldung fehlgeschlagen',
    googleErrorDesc: 'Wir konnten die Google-Anmeldung nicht starten. Bitte versuche es erneut.',
    googleDemoBadge: 'Lokale Demo',
    googleDemoTitle: 'Mit Google anmelden (Demo)',
    googleDemoDesc: 'Dieser Server hat keine Google-OAuth-Anmeldedaten, daher wird eine Demo-Auswahl angezeigt. Wähle eine beliebige E-Mail, um fortzufahren.',
    googleDemoEmailLabel: 'Google-E-Mail',
    googleDemoContinue: 'Weiter',
    googleSetupLink: 'Funktioniert die Google-Anmeldung nicht? Hier beheben',
    googleSetupTitle: 'Google-Anmeldung einrichten',
    googleSetupIntro: 'Google lehnt die Anmeldung ab, bis genau dieser Redirect-URI in deiner Google Cloud Console registriert ist.',
    googleSetupUriLabel: 'Autorisierte Redirect-URI',
    googleSetupCopy: 'Kopieren',
    googleSetupCopied: 'Kopiert!',
    googleSetupSteps: [
      'Öffne console.cloud.google.com und gehe zu APIs & Services → Credentials.',
      'Öffne deinen OAuth-2.0-Client (Web).',
      'Klicke unter „Authorized redirect URIs“ auf „Add URI“.',
      'Füge die URI unten ein und speichere.',
      'Warte ein paar Minuten — Google kann die Änderung zeitverzögert anwenden.',
    ],
    googleSetupNote: 'Solange die App im Testing-Modus ist, muss dein Google-Konto als Testnutzer hinzugefügt sein.',
    googleSetupClose: 'Fertig',
""",
}

ANCHOR = "    resetToastTitle:"
SENTINEL = "googleSetupTitle:"


def main() -> None:
    for lang, block in BLOCKS.items():
        path = ROOT / f"{lang}.ts"
        text = path.read_text(encoding="utf-8")
        if SENTINEL in text:
            print(f"{lang}: already present — skipped")
            continue
        lines = text.splitlines(keepends=True)
        out = []
        inserted = False
        for line in lines:
            if not inserted and line.startswith(ANCHOR):
                out.append(block)
                inserted = True
            out.append(line)
        if not inserted:
            raise SystemExit(f"{lang}: anchor not found — aborting")
        path.write_text("".join(out), encoding="utf-8")
        print(f"{lang}: inserted 17 keys before resetToastTitle")


if __name__ == "__main__":
    main()
