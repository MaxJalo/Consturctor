from app.services.speaker_bank import best_voice_match, fio_initials, relabel_speaker, voice_labels


def test_fio_initials() -> None:
    assert fio_initials("Амураль Игорь Борисович") == "Амураль И.Б."
    assert fio_initials("Донцова  анна") == "Донцова А."
    assert fio_initials("Ксения") == "Ксения"


def test_known_voice_needs_a_clear_winner() -> None:
    ivan = [1.0, 0.0, 0.0]
    petr = [0.0, 1.0, 0.0]
    profiles = [
        ("p1", "u1", "Иванов Иван", ivan),
        ("p2", "u2", "Петров Пётр", petr),
    ]
    match = best_voice_match([0.99, 0.01, 0.0], profiles)
    assert match is not None
    assert match["fio"] == "Иванов Иван"

    ambiguous = best_voice_match([0.7, 0.7, 0.0], profiles)
    assert ambiguous is None

    stranger = best_voice_match([0.0, 0.0, 1.0], profiles)
    assert stranger is None


def test_relabel_replaces_only_voice_marks() -> None:
    mapping = {"Голос 2": "Амураль Игорь Борисович"}
    text = "[00:01–00:04] Голос 2: план факта\n[00:05–00:08] Голос 1 + Голос 2 (одновременно): да"
    renamed = relabel_speaker(text, mapping)
    assert "Амураль Игорь Борисович" in renamed
    assert "Голос 1" in renamed
    assert "Голос 2" not in renamed.replace("Амураль Игорь Борисович", "")
    labels = voice_labels(
        [
            {"speaker": "Голос 1"},
            {"speaker": "Голос 1 + Голос 2 (одновременно)"},
        ]
    )
    assert labels == ["Голос 1", "Голос 2"]
