using System;
using System.Windows;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Threading;

namespace MAX.Desktop.Pet;

public enum MaxPetMood
{
    Sleeping,
    Idle,
    Listening,
    Speaking,
    Happy,
    Surprised,
    Dizzy
}

/// <summary>
/// MAX's original animated character. It is drawn as WPF geometry rather than
/// loading a bitmap so the eyes, mouth, sparks, and small idle motion can react
/// to the assistant state without needing an external asset or model.
/// </summary>
public sealed class MaxPetControl : FrameworkElement
{
    public static readonly DependencyProperty MoodProperty = DependencyProperty.Register(
        nameof(Mood),
        typeof(MaxPetMood),
        typeof(MaxPetControl),
        new FrameworkPropertyMetadata(MaxPetMood.Idle, FrameworkPropertyMetadataOptions.AffectsRender));

    private readonly DispatcherTimer _animationTimer;
    private readonly Random _random = new();
    private DateTime _nextBlinkAtUtc = DateTime.UtcNow.AddSeconds(2.4);
    private DateTime _blinkUntilUtc = DateTime.MinValue;
    private Point _look = new(0.5, 0.45);
    private double _phase;

    public MaxPetControl()
    {
        Width = 96;
        Height = 78;
        Focusable = false;
        SnapsToDevicePixels = true;

        _animationTimer = new DispatcherTimer(DispatcherPriority.Render)
        {
            Interval = TimeSpan.FromMilliseconds(40)
        };
        _animationTimer.Tick += AnimationTimer_Tick;
        _animationTimer.Start();

        MouseMove += MaxPetControl_MouseMove;
        MouseLeave += (_, _) =>
        {
            _look = new Point(0.5, 0.45);
            InvalidateVisual();
        };
    }

    public MaxPetMood Mood
    {
        get => (MaxPetMood)GetValue(MoodProperty);
        set => SetValue(MoodProperty, value);
    }

    private void AnimationTimer_Tick(object? sender, EventArgs e)
    {
        _phase += 0.12;
        var now = DateTime.UtcNow;
        if (now >= _nextBlinkAtUtc)
        {
            _blinkUntilUtc = now.AddMilliseconds(125);
            _nextBlinkAtUtc = now.AddSeconds(2.0 + _random.NextDouble() * 4.0);
        }

        InvalidateVisual();
    }

    private void MaxPetControl_MouseMove(object sender, MouseEventArgs e)
    {
        if (ActualWidth <= 0 || ActualHeight <= 0)
            return;

        var point = e.GetPosition(this);
        _look = new Point(
            Math.Clamp(point.X / ActualWidth, 0, 1),
            Math.Clamp(point.Y / ActualHeight, 0, 1));
        InvalidateVisual();
    }

    protected override void OnRender(DrawingContext drawingContext)
    {
        base.OnRender(drawingContext);
        if (ActualWidth < 1 || ActualHeight < 1)
            return;

        var scale = Math.Min(ActualWidth / 120.0, ActualHeight / 94.0);
        var bob = Mood == MaxPetMood.Sleeping
            ? Math.Sin(_phase * 0.45) * 1.2
            : Math.Sin(_phase * 0.8) * 2.2;
        var centerX = ActualWidth / 2.0;
        var centerY = ActualHeight / 2.0 + bob;

        drawingContext.PushTransform(new TranslateTransform(centerX, centerY));
        drawingContext.PushTransform(new ScaleTransform(scale, scale));

        DrawShadow(drawingContext);
        DrawSparks(drawingContext);
        DrawCloud(drawingContext);
        DrawFace(drawingContext);
        DrawLightning(drawingContext);

        drawingContext.Pop();
        drawingContext.Pop();
    }

    private static void DrawShadow(DrawingContext dc)
    {
        dc.DrawEllipse(
            new SolidColorBrush(Color.FromArgb(48, 4, 14, 28)),
            null,
            new Point(0, 29),
            39,
            7);
    }

    private void DrawCloud(DrawingContext dc)
    {
        var geometry = new StreamGeometry();
        using (var path = geometry.Open())
        {
            path.BeginFigure(new Point(-47, 17), true, true);
            path.BezierTo(new Point(-53, 5), new Point(-45, -8), new Point(-32, -8), true);
            path.BezierTo(new Point(-31, -24), new Point(-15, -30), new Point(-4, -19), true);
            path.BezierTo(new Point(6, -36), new Point(29, -32), new Point(30, -13), true);
            path.BezierTo(new Point(45, -17), new Point(53, -4), new Point(48, 9), true);
            path.BezierTo(new Point(57, 20), new Point(40, 29), new Point(26, 25), true);
            path.BezierTo(new Point(14, 36), new Point(-8, 34), new Point(-17, 26), true);
            path.BezierTo(new Point(-29, 31), new Point(-47, 27), new Point(-47, 17), true);
            path.Close();
        }

        var fill = new LinearGradientBrush(
            Color.FromRgb(249, 253, 255),
            Color.FromRgb(140, 190, 222),
            new Point(0.35, 0),
            new Point(0.65, 1));
        var outline = new Pen(new SolidColorBrush(Color.FromRgb(17, 37, 63)), 2.2)
        {
            LineJoin = PenLineJoin.Round
        };
        dc.DrawGeometry(fill, outline, geometry);

        // A soft blue inner highlight makes the cloud read as a small illustrated
        // character instead of a flat system icon.
        var highlight = new SolidColorBrush(Color.FromArgb(95, 255, 255, 255));
        dc.DrawEllipse(highlight, null, new Point(-20, -18), 15, 5);
    }

    private void DrawFace(DrawingContext dc)
    {
        var blinking = DateTime.UtcNow < _blinkUntilUtc;
        var sleeping = Mood == MaxPetMood.Sleeping;
        var eyeY = -2.0;
        var eyeOpen = sleeping ? 0.08 : blinking ? 0.12 : 1.0;
        var eyeWhite = new SolidColorBrush(Color.FromRgb(255, 255, 255));
        var iris = new SolidColorBrush(Color.FromRgb(63, 213, 239));
        var pupil = new SolidColorBrush(Color.FromRgb(16, 26, 46));
        var left = new Point(-17, eyeY);
        var right = new Point(17, eyeY);

        if (sleeping)
        {
            DrawClosedEye(dc, left);
            DrawClosedEye(dc, right);
        }
        else
        {
            dc.DrawEllipse(eyeWhite, null, left, 10, 12 * eyeOpen);
            dc.DrawEllipse(eyeWhite, null, right, 10, 12 * eyeOpen);

            var lookX = (_look.X - 0.5) * 7.0;
            var lookY = (_look.Y - 0.45) * 5.0;
            dc.DrawEllipse(iris, null, new Point(left.X + lookX, left.Y + lookY), 5.7, 7.0 * eyeOpen);
            dc.DrawEllipse(iris, null, new Point(right.X + lookX, right.Y + lookY), 5.7, 7.0 * eyeOpen);
            dc.DrawEllipse(pupil, null, new Point(left.X + lookX, left.Y + lookY), 2.4, 4.1 * eyeOpen);
            dc.DrawEllipse(pupil, null, new Point(right.X + lookX, right.Y + lookY), 2.4, 4.1 * eyeOpen);
            dc.DrawEllipse(Brushes.White, null, new Point(left.X + lookX - 0.8, left.Y + lookY - 1.8), 1.1, 1.4);
            dc.DrawEllipse(Brushes.White, null, new Point(right.X + lookX - 0.8, right.Y + lookY - 1.8), 1.1, 1.4);
        }

        var ink = new Pen(new SolidColorBrush(Color.FromRgb(26, 20, 42)), 2.2)
        {
            StartLineCap = PenLineCap.Round,
            EndLineCap = PenLineCap.Round,
            LineJoin = PenLineJoin.Round
        };

        if (Mood == MaxPetMood.Surprised)
        {
            DrawBrow(dc, new Point(-17, -17), -0.28, ink);
            DrawBrow(dc, new Point(17, -17), 0.28, ink);
        }

        switch (Mood)
        {
            case MaxPetMood.Speaking:
                var open = 5.5 + (Math.Sin(_phase * 2.4) + 1) * 1.8;
                dc.DrawEllipse(new SolidColorBrush(Color.FromRgb(43, 18, 57)), null, new Point(0, 16), 7, open);
                dc.DrawEllipse(new SolidColorBrush(Color.FromRgb(240, 135, 177)), null, new Point(0, 19), 3.8, 1.5);
                break;
            case MaxPetMood.Surprised:
                dc.DrawEllipse(new SolidColorBrush(Color.FromRgb(43, 18, 57)), null, new Point(0, 16), 5, 7);
                break;
            case MaxPetMood.Happy:
                DrawSmile(dc, ink, 0, 12, 9, 7);
                break;
            case MaxPetMood.Dizzy:
                DrawSpiral(dc, ink, new Point(0, 16));
                break;
            default:
                DrawSmile(dc, ink, 0, 12, 7, 5);
                break;
        }
    }

    private static void DrawClosedEye(DrawingContext dc, Point center)
    {
        var pen = new Pen(new SolidColorBrush(Color.FromRgb(26, 20, 42)), 2.2)
        {
            StartLineCap = PenLineCap.Round,
            EndLineCap = PenLineCap.Round
        };
        var geometry = new StreamGeometry();
        using (var path = geometry.Open())
        {
            path.BeginFigure(new Point(center.X - 7, center.Y + 1), false, false);
            path.BezierTo(
                new Point(center.X - 3, center.Y + 5),
                new Point(center.X + 3, center.Y + 5),
                new Point(center.X + 7, center.Y + 1),
                true);
        }
        dc.DrawGeometry(null, pen, geometry);
    }

    private static void DrawSmile(DrawingContext dc, Pen pen, double x, double y, double width, double height)
    {
        var geometry = new StreamGeometry();
        using (var path = geometry.Open())
        {
            path.BeginFigure(new Point(x - width, y), false, false);
            path.BezierTo(
                new Point(x - width * 0.45, y + height),
                new Point(x + width * 0.45, y + height),
                new Point(x + width, y),
                true);
        }
        dc.DrawGeometry(null, pen, geometry);
    }

    private static void DrawBrow(DrawingContext dc, Point center, double slant, Pen pen)
    {
        var geometry = new StreamGeometry();
        using (var path = geometry.Open())
        {
            path.BeginFigure(new Point(center.X - 6, center.Y), false, false);
            path.LineTo(new Point(center.X + 6, center.Y + slant * 12), true);
        }
        dc.DrawGeometry(null, pen, geometry);
    }

    private static void DrawSpiral(DrawingContext dc, Pen pen, Point center)
    {
        var geometry = new StreamGeometry();
        using (var path = geometry.Open())
        {
            path.BeginFigure(new Point(center.X - 5, center.Y), false, false);
            path.BezierTo(
                new Point(center.X - 6, center.Y - 6),
                new Point(center.X + 7, center.Y - 7),
                new Point(center.X + 6, center.Y + 1),
                true);
            path.BezierTo(
                new Point(center.X + 5, center.Y + 5),
                new Point(center.X - 3, center.Y + 5),
                new Point(center.X - 2, center.Y + 1),
                true);
        }
        dc.DrawGeometry(null, pen, geometry);
    }

    private void DrawLightning(DrawingContext dc)
    {
        if (Mood is MaxPetMood.Sleeping or MaxPetMood.Idle)
            return;

        var glow = new Pen(new SolidColorBrush(Color.FromArgb(120, 255, 230, 95)), 4.2)
        {
            StartLineCap = PenLineCap.Round,
            EndLineCap = PenLineCap.Round,
            LineJoin = PenLineJoin.Round
        };
        var bolt = new Pen(new SolidColorBrush(Color.FromRgb(255, 222, 74)), 2.2)
        {
            StartLineCap = PenLineCap.Round,
            EndLineCap = PenLineCap.Round,
            LineJoin = PenLineJoin.Round
        };

        DrawBolt(dc, -48, -1, glow);
        DrawBolt(dc, -48, -1, bolt);
        DrawBolt(dc, 48, 2, glow, mirrored: true);
        DrawBolt(dc, 48, 2, bolt, mirrored: true);
    }

    private static void DrawBolt(DrawingContext dc, double x, double y, Pen pen, bool mirrored = false)
    {
        var direction = mirrored ? -1 : 1;
        var geometry = new StreamGeometry();
        using (var path = geometry.Open())
        {
            path.BeginFigure(new Point(x, y - 10), false, false);
            path.LineTo(new Point(x + direction * 7, y - 1), true);
            path.LineTo(new Point(x + direction * 1, y - 1), true);
            path.LineTo(new Point(x + direction * 8, y + 10), true);
        }
        dc.DrawGeometry(null, pen, geometry);
    }

    private void DrawSparks(DrawingContext dc)
    {
        if (Mood is MaxPetMood.Sleeping or MaxPetMood.Idle)
            return;

        var alpha = (byte)(125 + (Math.Sin(_phase * 2) + 1) * 45);
        var pen = new Pen(new SolidColorBrush(Color.FromArgb(alpha, 255, 242, 145)), 1.8)
        {
            StartLineCap = PenLineCap.Round,
            EndLineCap = PenLineCap.Round
        };
        DrawSpark(dc, new Point(-55, -24), 3, pen);
        DrawSpark(dc, new Point(55, -22), 3, pen);
    }

    private static void DrawSpark(DrawingContext dc, Point point, double size, Pen pen)
    {
        dc.DrawLine(pen, new Point(point.X - size, point.Y), new Point(point.X + size, point.Y));
        dc.DrawLine(pen, new Point(point.X, point.Y - size), new Point(point.X, point.Y + size));
    }
}
