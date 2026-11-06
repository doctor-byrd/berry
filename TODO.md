Priority
    - Add Real Time Communications services for `ProsodyIM` & `LiveKit`
    - Build service layer APIs for `PayRam` & `Blnk`
    - Validate auth implemnetation
    - Determine service that should be used for mini app bundles, recommend using `Ionic Portals` to run apps client side and store and serve app bundles from `MinIO`, Third party developers can build their apps using `Ionic Capcitor`
    
Non-Priority
    - We have the `@pydantic/monty` library, should implement a scripting engine module in NestJS application
        - We will need to update the entity to store user python scripts, 
        - We should also define a generic interface that allows developer to define what tools will be exposed to scripting engine bridge at runtime, this allows different engines with different bridge functions exposed. Should do this in a general purpose way
    - We also have the `needle-rs` library, we can use this to create an AI module which will pull a `Needle 2` model, this model can receive user input and execute various application functions as tool calls.
    - We also have the `falkordb` library, our infrastruture uses the `FalkorDB` docker image for Redis, this allows us graph capabilities (we also have our existing pgvector database if needed, but not necessary for now). We likely should build a graph module to interact with our FalcorDB instance.