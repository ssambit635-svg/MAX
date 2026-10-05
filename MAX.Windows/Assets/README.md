# Character asset integration

`/pikachu.zip` at the repository root contains `source/Pikachu.zip`, which includes `PikachuM.FBX` and its UV texture maps. The current native WPF window draws a small vector placeholder so the command MVP does not need a 3D runtime. The FBX package is not a sprite sheet; a later character milestone should import and render it, establish camera framing, and author idle/listening/speaking animation states before replacing the placeholder.
