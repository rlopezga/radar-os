# SYSTEM_CONTEXT.md

## Que es este sistema

Este workspace forma parte de **ATENEA v1**, un sistema personal de apoyo a la decision con memoria validada.

`radar-os` es el sistema de captura de senales y materiales que alimentan la capa de evidencia del sistema.

No es el nucleo de memoria ni el sistema de ejecucion.
Su dependencia principal es `atenea`.

## Repositorios del sistema

### `atenea`

Fuente de verdad operativa para:

- memoria consolidada
- tareas canónicas
- objetivos activos
- review pendiente
- contexto compartido

### `work-os`

Asistente profesional documental.

### `personal-os`

Asistente personal documental.

### `productivity-os`

Sistema de ejecucion.

### `radar-os`

Buzon de senales y aprendizaje.

Responsabilidades:

- capturar transcripciones
- almacenar recursos y referencias
- recoger notas sueltas
- canalizar materiales a `atenea`

## Regla principal

`radar-os` debe funcionar como capa de entrada y observacion, no como memoria consolidada.

## Que debe hacer este repo

- recoger materiales relevantes
- separar inputs por tipo y procedencia
- facilitar su posterior ingestión en `atenea`
- ayudar a detectar contenido que requiera review

## Que no debe hacer

- consolidar memoria interpretativa directamente
- duplicar la memoria validada de `atenea`
- redefinir tareas u objetivos como fuente final
- escribir directamente en tablas de base de datos

## Integracion con `atenea`

La integracion debe seguir:

[docs/ATENEA_INTEGRATION_CONTRACT.md](/Users/raullopezgarcia/pka-v1/atenea/docs/ATENEA_INTEGRATION_CONTRACT.md)

Puntos base:

- enviar materiales a endpoints de ingestión de `atenea`
- usar `raw` para evidencia y materiales de entrada
- usar review cuando haya interpretacion relevante
- mantener clara la esfera correcta cuando proceda

## Como deben trabajar las IAs en este repo

1. Si la tarea afecta a memoria, tareas, objetivos o review canónicos, el repo prioritario es `atenea`.
2. Si aqui se documenta un cambio que afecte a integracion o contratos, debe propagarse tambien a `atenea`.
3. Este repo no debe asumir que todo input se convierte en memoria; mucha informacion quedara como evidencia bruta o pendiente de revision.
