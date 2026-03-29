# radar-os

Sistema de captura de senales, contenidos y materiales de aprendizaje dentro de ATENEA v1.

Lee primero [SYSTEM_CONTEXT.md](/Users/raullopezgarcia/pka-v1/radar-os/SYSTEM_CONTEXT.md) para entender como encaja este repositorio dentro del sistema completo.

## Rol

`radar-os` funciona como buzon de entrada para materiales que pueden enriquecer el sistema:

- transcripciones
- notas rapidas
- recursos
- videos
- lecturas
- ideas a revisar

No consolida memoria interpretativa por si mismo.
Su funcion es alimentar `atenea` con evidencia y material pendiente de clasificacion o validacion.

## Estructura minima

```text
radar-os/
  README.md
  SYSTEM_CONTEXT.md
  AGENTS.md
  CLAUDE.md
  transcripts/
  resources/
  notes/
  inbox/
  proposals/
```

## Regla de integracion

Los contenidos capturados aqui deben terminar en `atenea` como:

- `raw_items` cuando sean evidencia o material bruto
- `review_items` cuando impliquen interpretacion, patrones o cambios de criterio

La referencia de integracion es:

[docs/ATENEA_INTEGRATION_CONTRACT.md](/Users/raullopezgarcia/pka-v1/atenea/docs/ATENEA_INTEGRATION_CONTRACT.md)

## Que debe vivir aqui

- transcripciones pendientes de procesar
- recursos y lecturas
- notas de exploracion
- propuestas de temas a revisar
- materiales de entrada para aprendizaje y refinamiento

## Que no debe vivir aqui como verdad final

- memoria validada canónica
- objetivos operativos canónicos
- tareas canónicas
- interpretaciones consolidadas sin pasar por `atenea`
