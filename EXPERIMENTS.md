# Guide des Experiments Discord (Equicord)

> Ce document résume comment fonctionnent réellement les experiments Discord,
> ce que le plugin **Experiments** de ce fork peut forcer, et pourquoi certaines
> fonctionnalités ne s'affichent pas. Basé sur la doc technique de Discord
> Userdoccers, le datamining de Wumpus Central et les trackers de rollouts.

## Les deux systèmes d'experiments

### 1. Système legacy (user / guild)
- Le client reçoit les **populations** (filtres + plages de hash) et calcule
  lui-même le bucket → **forçable côté client** (c'est ce que fait le plugin).
- **Experiments user** : bucket calculé sur ton ID utilisateur.
- **Experiments guild** : bucket calculé par serveur, avec des filtres :
  features du serveur (COMMUNITY, INTERNAL_EMPLOYEE_ONLY...), nombre de membres,
  ancienneté, whitelist d'IDs de serveurs posée à la main par Discord.

### 2. Système Apex (le nouveau)
- Les variants sont attribués **côté serveur, par unité** (utilisateur,
  installation, serveur). Le client ne reçoit que le résultat final —
  volontairement moins de données pour éviter la divulgation des features.
- **Conséquence** : forcer un experiment Apex depuis le plugin ne fait
  souvent rien.

## Ce que le plugin peut / ne peut pas faire

| Peut | Ne peut pas |
|---|---|
| Forcer les buckets des experiments legacy (user + guild) côté client | Forcer les experiments Apex (données côté serveur) |
| Afficher la liste complète des experiments | Débloquer les features gated serveur (whitelists d'IDs, INTERNAL_EMPLOYEE_ONLY) |
| Sauvegarder tes overrides localement | Utiliser "Send to Client" (le serveur n'accepte que les overrides des employés Discord) |
| Ouvrir la page Experiments + menu dev | Empêcher l'écran "Une erreur s'est produite" si le code de la feature n'est pas dans ton build |

## Pourquoi un experiment forcé ne s'affiche pas

1. **Holdout** : un second experiment désactive celui que tu as forcé.
2. **Dépendance** : flag `DEPENDENT_EXPERIMENT` — une autre experiment doit
   aussi être active.
3. **Filtres guild** : le experiment ne s'applique qu'à des serveurs précis
   (features, taille, whitelist). Ton override user ne change pas
   l'éligibilité du serveur.
4. **Experiment Apex** : non forçable côté client (voir plus haut).
5. **Build client** : sur stable, le code n'est parfois livré que sur Canary →
   d'où l'écran d'erreur *"Oh non ! Une erreur s'est produite"*, qui est le
   crash boundary du composant manquant.
6. **Redémarrage incomplet** : les assignments sont évalués au boot ; fermer
   Discord **y compris l'icône de la barre des tâches** avant de rouvrir.
7. **Version web** : de nombreux experiments desktop n'ont aucun effet sur la
   version navigateur.

## Pourquoi d'autres personnes "ont" les features serveur

- **Elles sont employés/testeurs Discord** : les vrais overrides sont posés
  manuellement via l'admin panel interne, et beaucoup de rollouts sont
  réservés aux serveurs `INTERNAL_EMPLOYEE_ONLY`.
- **Elles sont dans le vrai rollout A/B** : beaucoup d'experiments tournent
  à 1–50 % de la population — elles ne les ont pas "forcées".
- **UI fakée côté client** : un mod peut dessiner l'interface localement,
  mais les appels serveur derrière échouent (cosmétique).

## Workflow recommandé

1. Cherche le nom de l'experiment sur [wumpus.tools](https://wumpus.tools)
   ou le tracker de rollouts ci-dessous.
2. Force le bucket → **redémarre complètement** le client.
3. Si l'écran d'erreur apparaît → remets le bucket sur **None**
   (rien n'est cassé, l'erreur disparaît).
4. Si rien ne s'affiche sans erreur : cherche un **holdout** ou une
   dépendance, ou vérifie si c'est un experiment Apex / serveur à 0 %.

## Ressources

- **Doc technique** : https://docs.discord.food/topics/experiments
- **Liste des experiments** (user/guild/developer) : https://wumpus.tools
- **Datamining Canary** : https://github.com/Wumpus-Central
- **Tracker d'experiments serveur (JSON brut)** :
  https://github.com/Wumpus-Central/guild-experiments
- **Rollouts en direct** : https://rollouts.advaith.io
- **Features à venir (captures)** : https://discordpreviews.com
  (@DiscordPreviews sur X — serveur Discord de ~42k membres)
- **FAQ historique du forçage** :
  https://gist.github.com/MeguminSama/2cae24c9e4c335c661fa94e72235d4c4
